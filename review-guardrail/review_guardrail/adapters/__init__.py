"""评审适配器：llm(dsh) / static / hybrid，全部基于真实 diff，禁止模拟数据。

子模块在此显式导入，供 review.py 以 review_guardrail.adapters.<module> 访问。
"""
from __future__ import annotations

from . import dsh_review, static  # noqa: F401