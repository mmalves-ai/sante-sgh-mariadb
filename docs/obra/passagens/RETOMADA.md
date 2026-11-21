# RETOMADA (2026-11-21, 4h10)

Leia este arquivo primeiro. Depois o `docs/ESTADO.md` e o `AGENTS.md`.
- O protocolo de tokens é obrigatório, com as regras 20 a 22.
- Relatório a cada 50 minutos, com a seção Economia (`tools/obra/medir_consumo.py`), os termos da saúde
  explicados e o fluxo do dono sempre por painel.
- Ordem do dono: não parar até completar o sistema.

## No GitHub

- F0, F1, F2.1 e F2-L (login).
- F2.2 ondas 1 a 4: 39 módulos ligados (`eba07ff`).
- F4 L1 a L4: abridor, fila e motor, painel de onboarding, mapa e verificador (`3f493f4`).
- ADR 0003, itens 1 a 9.

## Rodando agora (workflows desta sessão; não relance)

- **F2.2, ondas finais** (`f22-ondas-finais`): as fatias foram geradas de novo com lotes de até 20 arquivos
  (regra 22). A numeração recomeçou:
  - onda 2: acesso, administração, **remoção da coexistência e do `onda0`** e SADT;
  - onda 3: cirurgia, pessoas, portal do paciente, suprimentos, telemedicina e TISS;
  - onda 4: contábil e portal do médico;
  - ondas 5a a 5d: testes, ferramentas, worker e a desmontagem do `app.module`.

  Os pedidos das ondas 1 a 4 antigas estão em `docs/obra/fatias/f22/arquivo-ondas-1a4/`.
- **F4 L5 a L8** (`f4-conector-l5-l8`), no worktree `../sante-sgh-wt/f4`, branch `f4-conector`: carga de todas
  as áreas em 57 fatias. Depois, faça o merge no `main`, como no L3: mescle o `main` no branch, resolva o
  `registro.ts` e faça o fast-forward.
- O worker do conector está no ar (`conector/conector.sh worker`) para o painel.

## Dívida da F2.2, a fechar antes de declarar a F2 pronta (F2.4)

Medido por script em 2026-11-21:
- 360 pedidos dos lotes: 163 de DDL, 63 de contrato, 19 de sementes no `criar_cliente` e 115 outros;
- 77 arquivos de produção ainda respondem 501 ou "modelo-pendente".

Exemplos:
- domínios básicos não semeados no cliente novo (sexo, tipos, situações da agenda);
- contratos ainda em HHMM, S/N e `destino: 'legado'`;
- tabela de feriado;
- busca fonética.

**F2.4:** classificar por script, aplicar o DDL e as sementes, trocar os contratos para vocabulário neutro e zerar
os 501. A prova é um verificador que conta 501 e "modelo-pendente" até chegar a 0.

## Pendências

- **Decisão do dono:** segundo fator no login do administrador da plataforma. Recomendado: sim.
- O dono ainda não criou a ProntoCardio no painel.
- Bancos de teste `f22_o1` a `f22_o5` e `teste_*` aparecem na lista do painel. Apague-os ao fim da F2.2.
- O orquestrador desta sessão passou de 1.000 turnos, mas custa cerca de 43 mil equivalentes por turno, cerca de
  2% do total. Passe a orquestração para uma sessão nova quando os dois workflows acima terminarem.

## Ambiente

- MariaDB `127.0.0.1:3410`, Oracle de referência, web `0.0.0.0:5310` e API `127.0.0.1:3310`
  (`API_MODULOS=todos tools/dev/subir-login.sh`).
- Disco: cerca de 236 GB livres, depois que o volume do ensaio do `new-sgh` foi apagado com autorização do dono.
