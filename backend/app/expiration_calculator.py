"""
Expiration Calculator module for NewAPI Middleware Tool.
Handles expiration time calculation for redemption codes.
"""
import time
from datetime import datetime
from enum import Enum
from typing import List


# Seconds per day
SECONDS_PER_DAY = 86400


class ExpireMode(str, Enum):
    """Expiration time modes."""
    NEVER = "never"
    DAYS = "days"
    DATE = "date"


def calculate_never_expiration() -> int:
    """
    Calculate expiration time for never-expiring codes.
    
    Returns:
        0 (indicating no expiration).
    """
    return 0


def calculate_days_expiration(days: int, current_timestamp: int | None = None) -> int:
    """
    Calculate expiration time based on number of days from now.
    
    Args:
        days: Number of days until expiration.
        current_timestamp: Optional current Unix timestamp (for testing).
                          If None, uses current time.
        
    Returns:
        Unix timestamp of expiration (current_timestamp + days * 86400).
        
    Raises:
        ValueError: If days is negative.
    """
    if days < 0:
        raise ValueError("Days must be non-negative")
    
    if current_timestamp is None:
        current_timestamp = int(time.time())
    
    return current_timestamp + (days * SECONDS_PER_DAY)


def calculate_date_expiration(expire_date: str | datetime) -> int:
    """
    Calculate expiration time from a specific date/datetime.
    
    Args:
        expire_date: Expiration date as ISO 8601 string or datetime object.
        
    Returns:
        Unix timestamp of the expiration date.
        
    Raises:
        ValueError: If date format is invalid.
    """
    if isinstance(expire_date, str):
        try:
            # Try parsing ISO 8601 format with time
            dt = datetime.fromisoformat(expire_date.replace("Z", "+00:00"))
        except ValueError:
            try:
                # Try parsing date-only format
                dt = datetime.strptime(expire_date, "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"Invalid date format: {expire_date}. Use ISO 8601 format.")
    elif isinstance(expire_date, datetime):
        dt = expire_date
    else:
        raise ValueError(f"expire_date must be string or datetime, got {type(expire_date)}")
    
    return int(dt.timestamp())


def unix_to_datetime(timestamp: int) -> datetime:
    """
    Convert Unix timestamp to datetime object.
    
    Args:
        timestamp: Unix timestamp.
        
    Returns:
        datetime object.
    """
    return datetime.fromtimestamp(timestamp)


def calculate_expiration(
    mode: ExpireMode,
    days: int | None = None,
    expire_date: str | datetime | None = None,
    current_timestamp: int | None = None,
) -> int:
    """
    Calculate expiration time based on the specified mode.
    
    Args:
        mode: Expiration mode (never, days, or date).
        days: Number of days for 'days' mode.
        expire_date: Expiration date for 'date' mode.
        current_timestamp: Optional current timestamp for testing.
        
    Returns:
        Unix timestamp of expiration (0 for never).
        
    Raises:
        ValueError: If required parameters are missing or invalid.
    """
    if mode == ExpireMode.NEVER:
        return calculate_never_expiration()
    
    elif mode == ExpireMode.DAYS:
        if days is None:
            raise ValueError("days is required for days mode")
        return calculate_days_expiration(days, current_timestamp)
    
    elif mode == ExpireMode.DATE:
        if expire_date is None:
            raise ValueError("expire_date is required for date mode")
        return calculate_date_expiration(expire_date)
    
    else:
        raise ValueError(f"Unknown expire mode: {mode}")


def generate_expirations(
    count: int,
    mode: ExpireMode,
    days: int | None = None,
    expire_date: str | datetime | None = None,
    current_timestamp: int | None = None,
) -> List[int]:
    """
    Generate a list of expiration times.
    
    Args:
        count: Number of expiration times to generate.
        mode: Expiration mode.
        days: Number of days for 'days' mode.
        expire_date: Expiration date for 'date' mode.
        current_timestamp: Optional current timestamp for testing.
        
    Returns:
        List of Unix timestamps (all same value since expiration is uniform).
    """
    if count < 1:
        raise ValueError("Count must be at least 1")
    
    expiration = calculate_expiration(mode, days, expire_date, current_timestamp)
    return [expiration] * count
