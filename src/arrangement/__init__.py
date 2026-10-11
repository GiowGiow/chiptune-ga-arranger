"""Arrangements for the four channels of the NES sound chip.

The NES (2A03) chip plays four voices, each one note at a time: two pulse waves (P1, P2), a
triangle wave (TR) and a noise generator (NO). This package turns an arrangement plan (one texture
choice per channel and bar) into concrete notes, and checks the result against the chip's rules.
"""
