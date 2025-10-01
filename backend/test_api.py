"""
快速测试 NewAPI 工具的所有功能
"""
import asyncio
import httpx
import json

API_BASE = "http://localhost:8000/api/v1"


async def test_health():
    """测试健康检查"""
    print("\n=== 1. 测试健康检查 ===")
    async with httpx.AsyncClient() as client:
        response = await client.get("http://localhost:8000/health")
        print(f"状态: {response.status_code}")
        print(f"响应: {response.json()}")


async def test_user_ranking():
    """测试用户排行"""
    print("\n=== 2. 测试用户排行（本周额度消耗 Top 10） ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{API_BASE}/stats/user-ranking",
            params={
                'period': 'week',
                'metric': 'quota',
                'limit': 10
            }
        )
        data = response.json()
        print(f"状态: {response.status_code}")
        print(f"总数: {data.get('count')}")
        
        if data.get('ranking'):
            print("\n排行榜:")
            for user in data['ranking'][:5]:
                print(f"  {user['rank']}. {user['username']}")
                print(f"     请求数: {user['requests']:,}")
                print(f"     额度: {user['quota']:,}")
                print()


async def test_model_stats():
    """测试模型统计"""
    print("\n=== 3. 测试模型统计（今日） ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{API_BASE}/stats/model-stats",
            params={'period': 'day'}
        )
        data = response.json()
        print(f"状态: {response.status_code}")
        print(f"总数: {data.get('count')}")
        
        if data.get('models'):
            print("\n热门模型:")
            for model in data['models'][:5]:
                print(f"  {model['rank']}. {model['model_name']}")
                print(f"     请求数: {model['total_requests']:,}")
                print(f"     成功率: {model['success_rate']}%")
                print(f"     Token: {model['total_tokens']:,}")
                print()


async def test_token_consumption():
    """测试 Token 统计"""
    print("\n=== 4. 测试 Token 统计（本周总计） ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{API_BASE}/stats/token-consumption",
            params={
                'period': 'week',
                'group_by': 'total'
            }
        )
        data = response.json()
        print(f"状态: {response.status_code}")
        print(f"\n本周统计:")
        print(f"  总请求数: {data.get('total_requests', 0):,}")
        print(f"  总额度: {data.get('total_quota', 0):,}")
        print(f"  Prompt Tokens: {data.get('total_prompt_tokens', 0):,}")
        print(f"  Completion Tokens: {data.get('total_completion_tokens', 0):,}")
        print(f"  总 Tokens: {data.get('total_tokens', 0):,}")


async def test_daily_trend():
    """测试每日趋势"""
    print("\n=== 5. 测试每日趋势（7天） ===")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{API_BASE}/stats/daily-trend",
            params={'days': 7}
        )
        data = response.json()
        print(f"状态: {response.status_code}")
        
        if data.get('data'):
            print("\n每日数据:")
            for day in data['data']:
                print(f"  {day['date']}:")
                print(f"    请求数: {day['requests']:,}")
                print(f"    额度: {day['quota']:,}")
                print(f"    Tokens: {day['total_tokens']:,}")
                print(f"    成功率: {day['success_rate']}%")


async def test_overview():
    """测试总览"""
    print("\n=== 6. 测试总览数据 ===")
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(f"{API_BASE}/stats/overview")
        data = response.json()
        print(f"状态: {response.status_code}")
        
        print("\n今日:")
        print(f"  请求数: {data['today']['requests']:,}")
        print(f"  额度: {data['today']['quota']:,}")
        print(f"  Tokens: {data['today']['tokens']:,}")
        
        print("\n本周:")
        print(f"  请求数: {data['week']['requests']:,}")
        print(f"  额度: {data['week']['quota']:,}")
        print(f"  Tokens: {data['week']['tokens']:,}")
        
        print("\n本月:")
        print(f"  请求数: {data['month']['requests']:,}")
        print(f"  额度: {data['month']['quota']:,}")
        print(f"  Tokens: {data['month']['tokens']:,}")


async def test_batch_redemption():
    """测试批量生成兑换码"""
    print("\n=== 7. 测试批量生成兑换码 ===")
    print("生成 3 个随机额度（50000-100000）的兑换码...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{API_BASE}/redemption/batch",
            json={
                'count': 3,
                'quota_type': 'random',
                'min_quota': 50000,
                'max_quota': 100000,
                'expired_time': 0,
                'name_prefix': 'Test'
            }
        )
        data = response.json()
        print(f"状态: {response.status_code}")
        print(f"成功生成: {data.get('created')}/{data.get('total')}")
        
        if data.get('redemptions'):
            print("\n生成的兑换码:")
            for item in data['redemptions']:
                print(f"  名称: {item['name']}")
                print(f"  Key: {item['key']}")
                print(f"  额度: {item['quota']:,}")
                print()


async def main():
    """运行所有测试"""
    print("="*60)
    print("NewAPI 统计工具 - 功能测试")
    print("="*60)
    
    try:
        await test_health()
        await test_user_ranking()
        await test_model_stats()
        await test_token_consumption()
        await test_daily_trend()
        await test_overview()
        
        # 兑换码测试（可选，会真实创建兑换码）
        confirm = input("\n是否测试批量生成兑换码？(会真实创建) [y/N]: ")
        if confirm.lower() == 'y':
            await test_batch_redemption()
        
        print("\n" + "="*60)
        print("✅ 所有测试完成！")
        print("="*60)
        
    except httpx.ConnectError:
        print("\n❌ 错误: 无法连接到服务器")
        print("请确保后端服务已启动: uvicorn app.main:app --reload")
    except Exception as e:
        print(f"\n❌ 测试失败: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())

