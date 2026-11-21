# Colunas declaradas por fatia (F4 L5 a L8)

Um arquivo por fatia: `<fatia>.tsv` (ex.: `L5-01.tsv`), mesmo formato de `../colunas.tsv`
(`tabela, coluna, destino, regra, depara, via, motivo`). Cada tabela da origem fica num só arquivo: a mesma tabela em
dois arquivos, ou a mesma (tabela, coluna, destino) duas vezes, é erro do verificador (`conector/verificar_mapa.py`).
Colunas especiais da carga dirigida pelo mapa: `=<texto>` (literal) e `@id` (id do destino principal).
