# TP1 – Composição Musical Algorítmica

DCC831 – IA Generativa para Música (UFMG, 2026/2)

## Método

<!-- Gramáticas generativas, algoritmos genéticos ou cadeias de Markov. Restrição estilística escolhida. -->

## Instalação

O projeto usa [uv](https://docs.astral.sh/uv/) e Python 3.12.

```bash
uv sync
uv run dcc831-tp1
```

Sem uv, use o `requirements.txt`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

O `requirements.txt` é gerado a partir do `uv.lock`. Depois de mudar dependências, rode:

```bash
uv export --format requirements-txt --no-hashes --no-emit-project -o requirements.txt
```

## Reprodução dos resultados

<!-- Comandos para gerar os MIDIs e sintetizar os áudios, com sementes e hiperparâmetros. -->

## Músicas geradas

<!-- Lista dos arquivos de áudio e a configuração de cada um. -->

## Uso de IA

<!-- Ferramentas de IA usadas e com qual objetivo (obrigatório pelo enunciado). -->
