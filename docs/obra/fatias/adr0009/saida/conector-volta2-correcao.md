# Lote conector, volta 2: correção da revisão (preço da origem, vigência e repasse integral)

Arquivos: `conector/sante_conector/preco_origem.py`, `conector/sante_conector/estruturar.py`,
`conector/testes/test_preco_origem.py`, `conector/testes/test_estrutura_agenda.py`.

## Achados (3, todos procedentes e corrigidos)
1. **Repasse integral fora do particular (média).** `_repasse` agora recebe as fontes particulares que `_precos`
   classificou (cadastro ou estimada; sem `_precos`, as de tipo particular do cadastro). A marca numa fonte que não é
   particular vira pendência `repasse:integral_fonte_nao_particular` (média) e nada é gravado. Uma regra antiga cuja
   fonte deixou de ser particular é fechada pelo laço de "marca que sumiu".
2. **Vigência com a data da carga (média, decisão 16).** Sem evidência, nada nasce com a data de hoje:
   - `_precos`: valor novo sem evidência vira pendência `vigencia:sem_evidencia` (chave convênio/inscrição), sem linha
     nem regra; entra no Sincronizar em que houver evidência;
   - `_repasse`: sem evidência, pendência e nada gravado;
   - `estruturar`: texto novo sem evidência fica guardado inteiro e `pendente`, sem regra; o Sincronizar com evidência
     o extrai (contagem `pendentes_extraidos`). `_gravar` não tem mais data padrão. Texto que mudou na origem continua
     valendo a partir da mudança (data do Sincronizar, a evidência é a própria mudança);
   - a vigência padrão do cliente passa a incluir a criação de todas as agendas da origem, e o docstring foi corrigido.
     A contagem `padrao_registro_mais_antigo` passou a se chamar `padrao_com_evidencia`.
3. **Decisão 24 sem teste (média).** O teste traz valor por médico na operadora ALFA (fonte 3): a linha fica
   `descartada` com o motivo da decisão 24, e não existe regra com essa fonte.

## Contagens
- `test_preco_origem.py`: 4 testes (3 puros + 1 com banco descartável), passam. O teste com banco ganhou o cenário sem
  evidência (4 valores → 4 pendências, 0 linhas, 0 regras), a operadora descartada e a marca na operadora (1 pendência,
  1 regra de repasse só na fonte particular).
- `test_estrutura_agenda.py`: 18 testes, passam (o de integração prova 3 textos pendentes sem evidência e a extração
  com a vigência da evidência depois).
- Suíte inteira do conector no container: 1230 testes, OK (10 pulados, 2 falhas esperadas).

## Pendências
- Nenhuma do lote. A medida na cópia real (`medir-adr9`) não foi refeita: a correção muda só a carga, não a medição.
