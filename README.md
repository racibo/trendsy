# Trendsy — GDELT proof of concept

A technical prototype for testing whether GDELT can provide stable daily popularity measurements for a curated set of people, events, countries and cities.

## Scope

This repository starts with a small, manually curated candidate set. It is a data-quality experiment, not the full game. The prototype will test GDELT DOC timeline measurements, preserve daily snapshots, and report missing or suspicious observations.

## Categories

- Global people
- Global events
- Countries
- Global cities
- Cities in Poland
- People in Polish media

## Data source

GDELT Project: https://www.gdeltproject.org/ . GDELT is the sole source for popularity measurements in this project. Candidate curation and entity disambiguation are separate from the measurement source.

## Daily history

Complete scheduled Web NGrams samples are archived as compact daily records in `data/history/`. See `docs/daily-data-archive.md` for the stored fields and completeness rules.

## Status

Initial repository scaffold. See `docs/data-methodology.md` for the measurement design and `data/candidates.json` for the initial test set.
