"""Genetic algorithm that searches for an arrangement plan.

Each individual is a plan: for every bar, which texture P2 plays, which bass texture TR plays,
which drum pattern NO plays and in which octave P1 plays the melody. A fitness function built from
music-theory heuristics scores each plan, and selection, crossover and mutation evolve better
plans over the generations.
"""
