"""
Key Generator module for NewAPI Middleware Tool.
Generates unique 32-character redemption code keys.
"""
import secrets
import time
from typing import List


def base36_encode(number: int) -> str:
    """
    Encode an integer to base36 string.
    
    Args:
        number: Non-negative integer to encode.
        
    Returns:
        Base36 encoded string (lowercase).
    """
    if number < 0:
        raise ValueError("Number must be non-negative")
    if number == 0:
        return "0"
    
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = []
    while number > 0:
        result.append(chars[number % 36])
        number //= 36
    return "".join(reversed(result))


class KeyGenerator:
    """
    Generator for unique 32-character redemption code keys.
    
    Key structure: [prefix][random_part][timestamp_base36][counter_base36]
    - prefix: User-specified prefix (0-20 chars)
    - random_part: Random bytes converted to hex (variable length)
    - timestamp_base36: Timestamp in base36 (8 chars)
    - counter_base36: Performance counter in base36 (4 chars)
    """
    
    TARGET_LENGTH = 32
    TIMESTAMP_LENGTH = 8
    COUNTER_LENGTH = 4
    MAX_PREFIX_LENGTH = 20
    
    def __init__(self):
        """Initialize the KeyGenerator."""
        self._counter = 0
    
    def generate_key(self, prefix: str = "") -> str:
        """
        Generate a unique 32-character key.
        
        Args:
            prefix: Optional prefix for the key (max 20 chars).
            
        Returns:
            A 32-character unique key string.
            
        Raises:
            ValueError: If prefix exceeds 20 characters.
        """
        if len(prefix) > self.MAX_PREFIX_LENGTH:
            raise ValueError(f"Prefix must not exceed {self.MAX_PREFIX_LENGTH} characters")
        
        # Calculate random part length
        random_length = max(
            8, 
            self.TARGET_LENGTH - len(prefix) - self.TIMESTAMP_LENGTH - self.COUNTER_LENGTH
        )
        
        # Generate random part using secure random bytes
        random_part = secrets.token_hex(random_length // 2 + 1)[:random_length]
        
        # Generate timestamp part (milliseconds since epoch in base36)
        timestamp_ms = int(time.time() * 1000)
        timestamp_b36 = base36_encode(timestamp_ms)[-self.TIMESTAMP_LENGTH:].zfill(self.TIMESTAMP_LENGTH)
        
        # Generate counter part (performance counter modulo to fit in 4 chars)
        # Using combination of perf_counter and internal counter for uniqueness
        perf_value = int(time.perf_counter() * 1000000) % 1679616  # 36^4 = 1679616
        self._counter = (self._counter + 1) % 1679616
        counter_value = (perf_value + self._counter) % 1679616
        counter_b36 = base36_encode(counter_value).zfill(self.COUNTER_LENGTH)[-self.COUNTER_LENGTH:]
        
        # Combine all parts
        key = f"{prefix}{random_part}{timestamp_b36}{counter_b36}"
        
        # Ensure exactly 32 characters
        if len(key) > self.TARGET_LENGTH:
            key = key[:self.TARGET_LENGTH]
        elif len(key) < self.TARGET_LENGTH:
            key = key.ljust(self.TARGET_LENGTH, "0")
        
        return key
    
    def generate_batch(self, count: int, prefix: str = "") -> List[str]:
        """
        Generate a batch of unique keys.
        
        Args:
            count: Number of keys to generate (1-1000).
            prefix: Optional prefix for all keys (max 20 chars).
            
        Returns:
            List of unique 32-character keys.
            
        Raises:
            ValueError: If count is not in range 1-1000 or prefix exceeds 20 chars.
        """
        if not 1 <= count <= 1000:
            raise ValueError("Count must be between 1 and 1000")
        if len(prefix) > self.MAX_PREFIX_LENGTH:
            raise ValueError(f"Prefix must not exceed {self.MAX_PREFIX_LENGTH} characters")
        
        keys = set()
        attempts = 0
        max_attempts = count * 3  # Allow some retries for collision handling
        
        while len(keys) < count and attempts < max_attempts:
            key = self.generate_key(prefix)
            keys.add(key)
            attempts += 1
        
        if len(keys) < count:
            raise RuntimeError(f"Failed to generate {count} unique keys after {max_attempts} attempts")
        
        return list(keys)


# Global instance for convenience
_key_generator: KeyGenerator | None = None


def get_key_generator() -> KeyGenerator:
    """Get or create the global KeyGenerator instance."""
    global _key_generator
    if _key_generator is None:
        _key_generator = KeyGenerator()
    return _key_generator
