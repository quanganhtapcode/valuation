"""
Data Sources Module
Provides unified access to various data sources:
- VCI (Vietcap) API for realtime prices
"""

from .vci import VCIClient

__all__ = ['VCIClient']
