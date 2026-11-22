# ADR 0009, volta 2, lote conector: o que mudou e medidas na cópia real

Medição: `conector/conector.sh medir-adr9 pc-20261019.fdb` (cópia restaurada da origem, só leitura), em 2026-11-22.
Só contagens; nada gravado. JSON completo em `/tmp/claude-1000/adr9/medir-adr9.json` (fora do git).

## O que mudou (só `conector/`)
- `sante_conector/preco_origem.py` (novo), etapa depois da carga do mapa, em toda execução (importar e Sincronizar):
  1. **Agenda sem profissional ligada pelo nome** (melhor estimativa): pelo menos duas palavras do nome da agenda,
     todas no nome de um único profissional. Ambígua: pendência visível `agenda:profissional_ambiguo_pelo_nome`,
     nada gravado.
  2. **Vigência por evidência (decisão 16):** a data mais antiga entre a criação da agenda na origem, a vigência
     cadastrada e o primeiro horário; senão a do registro mais antigo; sentinelas (antes de 1990) e futuro ignorados.
     Nunca a data da carga. Vale para o preço por médico, para as regras do texto e para o repasse integral; as
     estimadas antigas com vigência posterior à evidência são corrigidas.
  3. **Valor de consulta por médico e fonte** → `preco_consulta_origem` (íntegro); Sincronizar fecha a linha e a
     regra anteriores ontem quando o valor muda ou some.
  4. **Fonte particular classificada pelos dados** (ADR 0007, 18): vale o tipo `particular` do cadastro; senão a
     única fonte `outro` com valor por médico cujo nome ou classe diz PARTICULAR (pendência baixa
     `fonte:particular_estimada`).
  5. **Carga condicional:** só a fonte particular vira `regra_preco_particular` (dono o profissional, alvo consulta,
     estimada). Fonte de tipo conhecido não particular → `descartada` (decisão 24); `outro` fica pendente.
  6. **Repasse integral** (marca da origem) → `regra_repasse` + `regra_repasse_item` a 100% sobre o grupo de
     consultas do cliente (senão o item de consulta em consultório), base valor cobrado; marca que some fecha a regra.
- `estrutura_agenda.py` (extrator `conector-2`): "valor do exame particular" sem item → alvo `exame` (alvo novo do
  modelo, dono a agenda).
- `estruturar.py`: vigência recebida da evidência; texto igual com extrator novo é reextraído; texto mudado vale de
  hoje.
- `motor.py`: chama a etapa nova; pendências somadas ao relatório da execução. `cli.py`/`conector.sh`: `medir-adr9`.
- Mapa `L8-01.tsv`: `VLR_CONSULTA` documentada como lida pela etapa `preco_origem`.
- Testes: `testes/test_preco_origem.py` (3 puros + 1 com banco descartável, dados sintéticos) e caso novo em
  `test_estrutura_agenda.py`.

## Medidas na cópia real (contagens)
| Medida | Valor |
|---|---|
| Fontes pagadoras / com "particular" no nome | 77 / 3 |
| Fonte particular estimada pelos dados (nome + uso) | sim, 1 |
| Linhas de valor de consulta por médico (todas na fonte particular) | 113 |
| Médicos com regra de preço particular / valores distintos | 113 / 13 |
| Linhas de valor em outra fonte (convênio, descartadas pela decisão 24) | 0 |
| Fontes com a marca de repasse integral | 2 |
| Agendas / sem profissional na origem | 178 / 174 |
| Ligadas pelo nome / ambíguas (pendência) / sem correspondência | 134 / 7 / 33 |
| Agendas com data de criação válida (evidência de vigência) | 178 |
| Textos de agenda lidos / agendas com valor em reais no texto | 174 / 116 |
| Preços extraídos do texto: consulta / exame | 44 / 0 |
| Trechos interpretados / não interpretados | 110 / 1006 |
| Coberturas / restrições / preparos extraídos | 6 / 58 / 1 |
| Textos sem nenhuma regra | 92 |

## Pendências
- Os trechos não interpretados (1006) continuam valendo pelo texto, marcados na tela; é a maior parte (tabelas de
  procedimentos e valores em parcelas, que aguardam o item na revisão).
- A medição lê só os textos da agenda (observação e orientação do portal); os textos por convênio
  (`observacao_convenio`) são medidos na carga, não na imagem.
- 33 agendas sem profissional e sem correspondência pelo nome (agendas de serviço ou exame, sem médico).
- A carga completa num cliente de teste (contagens no banco) fica para a próxima importação pelo painel.
