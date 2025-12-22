"""
Quota Calculator module for NewAPI Middleware Tool.
Handles quota calculation for redemption codes.

Quota conversion: 1 USD = 500,000 Token
"""
import random
from enum import Enum
from typing import List


# Conversion rate: 1 USD = 500,000 tokens
TOKENS_PER_USD = 500000


class QuotaMode(str, Enum):
    """Quota calculation modes."""
    FIXED = "fixed"
    RANDOM = "random"


def calculate_fixed_quota(amount: float) -> int:
    """
    Calculate quota for a fixed amount.
    
    Args:
        amount: Amount in USD.
        
    Returns:
        Quota in tokens (amount * 500000, rounded).
        
    Raises:
        ValueError: If amount is negative.
    """
    if amount < 0:
        raise ValueError("Amount must be non-negative")
    return round(amount * TOKENS_PER_USD)


def calculate_random_quota(min_amount: float, max_amount: float) -> int:
    """
    Calculate a random quota within the specified range.
    
    Args:
        min_amount: Minimum amount in USD.
        max_amount: Maximum amount in USD.
        
    Returns:
        Random quota in tokens within [min_amount * 500000, max_amount * 500000].
        
    Raises:
        ValueError: If min_amount > max_amount or either is negative.
    """
    if min_amount < 0 or max_amount < 0:
        raise ValueError("Amounts must be non-negative")
    if min_amount > max_amount:
        raise ValueError("min_amount must not exceed max_amount")
    
    min_quota = round(min_amount * TOKENS_PER_USD)
    max_quota = round(max_amount * TOKENS_PER_USD)
    
    if min_quota == max_quota:
        return min_quota
    
    return random.randint(min_quota, max_quota)


def generate_quotas(
    count: int,
    mode: QuotaMode,
    fixed_amount: float | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
) -> List[int]:
    """
    Generate a list of quotas based on the specified mode.
    
    Args:
        count: Number of quotas to generate.
        mode: Quota calculation mode (fixed or random).
        fixed_amount: Amount for fixed mode (required if mode is FIXED).
        min_amount: Minimum amount for random mode (required if mode is RANDOM).
        max_amount: Maximum amount for random mode (required if mode is RANDOM).
        
    Returns:
        List of quota values in tokens.
        
    Raises:
        ValueError: If required parameters are missing or invalid.
    """
    if count < 1:
        raise ValueError("Count must be at least 1")
    
    if mode == QuotaMode.FIXED:
        if fixed_amount is None:
            raise ValueError("fixed_amount is required for fixed mode")
        quota = calculate_fixed_quota(fixed_amount)
        return [quota] * count
    
    elif mode == QuotaMode.RANDOM:
        if min_amount is None or max_amount is None:
            raise ValueError("min_amount and max_amount are required for random mode")
        return [calculate_random_quota(min_amount, max_amount) for _ in range(count)]
    
    else:
        raise ValueError(f"Unknown quota mode: {mode}")
