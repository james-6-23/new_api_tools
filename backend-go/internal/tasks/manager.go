package tasks

import (
	"context"
	"sync"
	"time"

	"github.com/ketches/new-api-tools/internal/logger"
	"go.uber.org/zap"
)

// TaskManager 后台任务管理器
type TaskManager struct {
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	tasks      map[string]*Task
	mu         sync.RWMutex
	warmupDone chan struct{}
}

// Task 后台任务
type Task struct {
	Name     string
	Interval time.Duration
	Handler  func(ctx context.Context) error
	Running  bool
	LastRun  time.Time
	LastErr  error
}

// TaskStatus 任务状态
type TaskStatus struct {
	Name     string    `json:"name"`
	Running  bool      `json:"running"`
	LastRun  time.Time `json:"last_run"`
	LastErr  string    `json:"last_error,omitempty"`
}

var (
	manager *TaskManager
	once    sync.Once
)

// GetManager 获取任务管理器单例
func GetManager() *TaskManager {
	once.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		manager = &TaskManager{
			ctx:        ctx,
			cancel:     cancel,
			tasks:      make(map[string]*Task),
			warmupDone: make(chan struct{}),
		}
	})
	return manager
}

// Register 注册任务
func (m *TaskManager) Register(name string, interval time.Duration, handler func(ctx context.Context) error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.tasks[name] = &Task{
		Name:     name,
		Interval: interval,
		Handler:  handler,
	}

	logger.Info("后台任务已注册", zap.String("task", name), zap.Duration("interval", interval))
}

// Start 启动所有任务
func (m *TaskManager) Start() {
	m.mu.RLock()
	defer m.mu.RUnlock()

	logger.Info("启动后台任务管理器", zap.Int("task_count", len(m.tasks)))

	for name, task := range m.tasks {
		m.wg.Add(1)
		go m.runTask(name, task)
	}
}

// StartAfterWarmup 在预热完成后启动任务
func (m *TaskManager) StartAfterWarmup(name string, interval time.Duration, handler func(ctx context.Context) error) {
	m.mu.Lock()
	m.tasks[name] = &Task{
		Name:     name,
		Interval: interval,
		Handler:  handler,
	}
	m.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()

		// 等待预热完成
		select {
		case <-m.warmupDone:
			logger.Info("预热完成，启动任务", zap.String("task", name))
		case <-m.ctx.Done():
			return
		}

		// 启动任务循环
		m.runTaskLoop(name, m.tasks[name])
	}()
}

// SignalWarmupDone 通知预热完成
func (m *TaskManager) SignalWarmupDone() {
	close(m.warmupDone)
	logger.Info("后台任务预热信号已发送")
}

// runTask 运行单个任务
func (m *TaskManager) runTask(name string, task *Task) {
	defer m.wg.Done()
	m.runTaskLoop(name, task)
}

// runTaskLoop 任务循环
func (m *TaskManager) runTaskLoop(name string, task *Task) {
	ticker := time.NewTicker(task.Interval)
	defer ticker.Stop()

	// 立即执行一次
	m.executeTask(name, task)

	for {
		select {
		case <-m.ctx.Done():
			logger.Info("后台任务已停止", zap.String("task", name))
			return
		case <-ticker.C:
			m.executeTask(name, task)
		}
	}
}

// executeTask 执行任务
func (m *TaskManager) executeTask(name string, task *Task) {
	m.mu.Lock()
	task.Running = true
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		task.Running = false
		task.LastRun = time.Now()
		m.mu.Unlock()
	}()

	if err := task.Handler(m.ctx); err != nil {
		m.mu.Lock()
		task.LastErr = err
		m.mu.Unlock()
		logger.Error("后台任务执行失败", zap.String("task", name), zap.Error(err))
	}
}

// Stop 停止所有任务
func (m *TaskManager) Stop() {
	logger.Info("正在停止后台任务管理器...")
	m.cancel()
	m.wg.Wait()
	logger.Info("后台任务管理器已停止")
}

// GetStatus 获取所有任务状态
func (m *TaskManager) GetStatus() []TaskStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make([]TaskStatus, 0, len(m.tasks))
	for _, task := range m.tasks {
		status := TaskStatus{
			Name:    task.Name,
			Running: task.Running,
			LastRun: task.LastRun,
		}
		if task.LastErr != nil {
			status.LastErr = task.LastErr.Error()
		}
		statuses = append(statuses, status)
	}

	return statuses
}

// IsWarmupDone 检查预热是否完成
func (m *TaskManager) IsWarmupDone() bool {
	select {
	case <-m.warmupDone:
		return true
	default:
		return false
	}
}
