# Conector (F4)

Motor que lê a base Firebird de origem de um cliente e a traz para o banco próprio. Plano:
`docs/obra/passagens/F4-plano.md`. O fluxo do dono é o **painel da plataforma** (L3); a linha de comando
daqui é só ferramenta interna de teste.

## Regras que o código garante

- Só este pacote fala com o Firebird, e **só lê**: transação `SNAPSHOT READ ONLY`, banco marcado read-only
  no snapshot antes da abertura.
- **O arquivo apontado nunca é alterado nem copiado inteiro** (plano A): o abridor monta o original num loop
  `--read-only` (o kernel recusa escrita; conferido por `blockdev --getro`) e põe por cima um snapshot
  copy-on-write do device-mapper. O que o Firebird escreve (cabeçalho, `gfix -mode read_only`) cai num COW
  esparso no volume de trabalho da execução, apagado no fim.
- **Plano B** (host sem dm/loop): cópia integral para o volume de trabalho, só se o disco livre depois da
  cópia continuar >= `CONECTOR_RESERVA_GB` (padrão 100); apagada no fim. `--modo auto` tenta A e cai em B.
- **Pasta autorizada** `CONECTOR_ORIGENS_DIR` (padrão: `banco-dev/backups` da área de trabalho), montada
  somente leitura em `/origens`. Só caminho relativo, sem `..`, sem symlink, arquivo regular `.fdb`,
  cabeçalho Firebird ODS 12 e tamanho múltiplo da página.
- Container `sante-sgh-conector` sempre `--network none`; `--privileged` só nos comandos que abrem o arquivo.
- Saídas só com metadados, contagens e hashes. Texto sai em bytes crus (`CAST ... CHARACTER SET OCTETS`);
  o hash da linha (BLAKE2b-128) é sobre os bytes crus, antes da conversão CP1252 → Unicode (`texto.py`).

## Uso interno

```bash
conector/conector.sh testes                       # autoconferência L1 sobre a imagem sintética (ok ou erros)
conector/conector.sh listar                       # .fdb da pasta autorizada, com aceite e motivo
conector/conector.sh validar pc-AAAAMMDD.fdb
conector/conector.sh registrar pc-AAAAMMDD.fdb --saida /saida/registro.json   # contagens + gstat
conector/conector.sh sintetica /saida/exemplo.fdb # imagem sintética do "cliente de exemplo"
conector/provar-l1-real.sh pc-AAAAMMDD.fdb        # prova: sha256/mtime antes e depois + contagens agregadas
```

Variáveis: `CONECTOR_ORIGENS_DIR`, `CONECTOR_SAIDA_DIR` (padrão `.tmp/conector`, fora do git),
`CONECTOR_COW_MB` (padrão 2048), `CONECTOR_RESERVA_GB` (padrão 100).

## Módulos

| Módulo | Papel |
|---|---|
| `caminho.py` | pasta autorizada, validação de caminho e cabeçalho, lista para o painel, sha256 |
| `abridor.py` | snapshot dm (plano A) e cópia com guarda de disco (plano B), sempre com limpeza |
| `leitor.py` | catálogo, contagem, leitura por faixa de PK inteira e por keyset, hash de linha e de bloco |
| `imagem.py` | registro da imagem (contagens por tabela, corte = mtime) e confronto com o gstat |
| `texto.py` | CP1252 → Unicode determinístico (0x81/0x8D/0x8F/0x90/0x9D viram o controle C1) |
| `sintetica.py` | gerador da imagem sintética do cliente de exemplo (dados falsos, semente fixa) |
| `cli.py` | ferramenta interna de teste |
