# Brief comum da F2.4 (dívida da migração)

## Objetivo
Zerar a dívida que a migração da API para o banco próprio deixou. A prova é
`python3 -I tools/obra/divida_f24.py --falhar-se-pendente` chegar a 0, com tsc e testes verdes. São três tipos:
- **modelo-pendente:** leitura ou gravação que recusa com `modelo-pendente` porque falta estrutura no banco. Para
  zerar:
  - ligue a porta à estrutura que já existe (o DDL pendente é aplicado antes, na etapa compartilhada; a lista está em
    `docs/obra/fatias/f24/saida/ddl-aplicado.md`);
  - ou, se faltar mesmo, peça em `docs/obra/fatias/f24/saida/<lote>.json` (tipo `ddl`, com tabela, colunas e
    motivo) e devolva em avisos.

  Nunca troque a recusa por vazio ou zero.
- **vocab-antigo:** vocabulário do legado em contrato, API ou web. A troca é sempre de ponta a ponta (contrato, API,
  web, domínio e testes juntos):
  - hora `HHMM` vira hora `HH:MM` (ou instante ISO quando é data e hora), pelos auxiliares neutros de
    `packages/contratos/src/formatacao/` criados na etapa compartilhada;
  - `'S' | 'N'` vira booleano;
  - `destino: 'legado'` sai.
- **nome-origem:** nome de tabela ou coluna do sistema de origem fora de `conector/`, `docs/analise/` e `referencias/`
  (regra de ouro 1).
  - Em comentário: reescreva com o termo de negócio em português, ou apague a referência se for só proveniência.
  - Em identificador, texto ou dado: use o nome de negócio do modelo próprio. O padrão dos códigos de permissão está
    em `docs/obra/fatias/f24/saida/padroes.md`.

## Arquivos SÓ do seu lote
Lotes rodam em paralelo na mesma pasta.
- Edite só os arquivos da sua `.lista` e os specs vizinhos deles (mesma pasta).
- Se precisar mudar um arquivo de fora (outro lote ou código compartilhado), escreva o pedido em
  `docs/obra/fatias/f24/saida/<lote>.json` e diga em avisos.
- Não faça commit.
- Não rode `prettier --write .` nem formatador na pasta inteira: só nos seus arquivos.

## Banco próprio por agente (dono)
- Testes de integração rodam no cliente de teste do seu lote (`# cliente_teste:` da `.lista`), com
  `SGH_CLIENTE_TESTE=<cliente>`. O conferidor cria esse cliente se faltar.
- Nunca use os clientes `f22_o*`, `demo` ou os do painel, nem apague banco de outro agente.

## Regras de ouro aplicáveis
- Nada do nome do sistema de origem nem do sistema de referência no modelo, no código ou nas telas.
- Regra de negócio no domínio, nunca em gatilho.
- Os domínios (`packages/dominio-*`) não importam banco nem I/O.
- Contratos com vocabulário neutro: booleano, data, id e número de negócio.
- Dados reais nunca em código, testes ou logs. Use só dados sintéticos.
- Nunca afrouxe um teste para passar: corrija a causa.

## Autoconferência (um comando, no máximo 3 vezes)
`tools/obra/conferir-lote-f24.sh <lote>` devolve `ok` ou a lista de erros.
- Erro de tsc em arquivo de outro lote vira aviso, porque os lotes andam juntos.
- Ao chegar perto de 100 turnos, grave o que fez e devolva `ok=false` com a lista exata do que falta.

## Saída
Arquivos editados no lugar e `docs/obra/fatias/f24/saida/<lote>.md` curto, com:
- o que mudou;
- as decisões tomadas pela melhor prática (para o dono ver);
- os pedidos.
