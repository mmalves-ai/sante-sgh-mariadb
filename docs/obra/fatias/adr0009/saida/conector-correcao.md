# Lote conector: correção da revisão (extrator do texto da agenda)

Arquivos: `conector/sante_conector/estrutura_agenda.py`, `conector/testes/test_estrutura_agenda.py`.

## Achados (4, todos procedentes e corrigidos)
1. **"NÃO ATENDEMOS" sem SUBPLANO (alta).** No texto por convênio, só com a palavra SUBPLANO(S) qualquer nome vira
   plano do convênio. Sem ela, só o nome que casa com o próprio convênio pelo cadastro. Se nada casa, a linha segue
   para as restrições: "NÃO ATENDEMOS CRIANÇAS MENORES DE 2 ANOS" dá idade mínima 2, e "NÃO ATENDEMOS RETORNO" dá
   aceita_retorno = falso. O que não for restrição fica não interpretado. Nenhum plano falso chega a `_plano`.
2. **Restrição parcial (média).** A linha é dividida em orações (vírgula, ponto, ponto e vírgula, travessão). Só é
   interpretada a oração que os padrões cobrem inteira, sobrando no máximo palavras neutras. O resto fica não
   interpretado, com motivo. Exceção no texto (EXCETO, SALVO, A NÃO SER...) ou valores em conflito: a linha toda fica
   sem regra. A idade passa a ser lida em qualquer ponto ("ACIMA DE N ANOS").
3. **Bloco de preparo (média).** O bloco termina também em linha com valor em reais e em linha que seja restrição
   inteira (um reconhecedor só, `_reconhecida`).
4. **Primeira palavra genérica (média).** A regra da marca pela primeira palavra (e a do prefixo do nome da fonte)
   ignora palavras genéricas (SAUDE, PLANO, CAIXA, ASSOCIACAO...). "SAUDE CAIXA" com a fonte "SAUDE BRADESCO" fica
   não interpretado ("convênio citado sem cadastro correspondente"). "ALFA S10" continua como subplano.

## Contagens
- Testes do extrator: 17 (eram 13; 4 novos com as frases da revisão). Passam 16, e 1 é pulado: é o de integração,
  que exige o Firebird e o MariaDB.
- Suíte inteira do conector no Python do sistema: 72 erros de importação (`pymysql` ausente), iguais antes e depois.

## Pendências
- O teste de integração (`test_estrutura_aceite_e_sincronizar`) não rodou neste ambiente.
