# RETOMADA (2026-11-20, 23:00)

Leia este arquivo primeiro. Depois o `docs/ESTADO.md` e o `AGENTS.md`: o protocolo de tokens é obrigatório e
o relatório segue o formato de 4 seções, a cada 50 minutos, com os termos da saúde explicados.

**Ordem do dono:** não parar até completar o sistema.

## Pronto e no GitHub

- F0, F1 (DDL das 3.500 tabelas e catálogos públicos), F2.1 (núcleo) e F2-L (login) (`9b0c83e`).
- O login está no ar em **https://192.168.0.104:5310**:
  - subir ou reiniciar: `tools/dev/subir-login.sh`;
  - cliente `demo`;
  - logins `admin` (administrador da plataforma, `POST /api/sessao/plataforma`) e `teste`, no estabelecimento
    `principal`;
  - senhas em `SEMEAR_*` do `.env`.

## Provas do F2-L (conferência independente)

- `tsc -p apps/api/tsconfig.login.json`: 0 erros.
- Vitest: 191 testes da API e 73 do núcleo.
- Validador do banco: 3.506 tabelas, 0 erros.
- Login ao vivo pelo IP: 201 com cookie `Secure`; senha errada dá 401.
- Revisão adversarial: 4 achados altos e 23 médios, todos corrigidos. A mensagem do commit diz "5 e 25" por
  engano de contagem.

## Próximo: F2.2 e F2.3, os demais módulos da API sobre o núcleo

1. **Planejar.** Classifique, por script, os 513 arquivos que importam `@sgh/legado`:
   - use `tools/obra/fecho-imports.py` e `tools/obra/contar-legado.sh`;
   - agrupe por módulo (`apps/api/src/modulos/*`).

   O plano segue as fichas: F2.2 é "adaptadores próprios" e F2.3 é "troca dos imports".
2. **Construir por módulo, um lote por agente.** Cada lote:
   - escreve as portas com SQL sobre as tabelas novas, pelo `@sgh/nucleo`;
   - liga o módulo no `modulos/registro.ts` (`API_MODULOS`);
   - inclui o fecho do módulo no `tsconfig.login.json` (ou num novo `tsconfig.base-api.json`);
   - tem os testes verdes.

   Comece pelo fluxo vertical **paciente → atendimento**, que é o portão da F2.
3. **Revisar adversarialmente e corrigir,** como no F2-L.

## Pendências

- **Decisão do dono:** segundo fator no login do administrador da plataforma. Recomendado: sim.
- `usuario.administrador_plataforma` (`02_ADM/04_tabelas.sql:74`) não tem mais efeito. Remover ou documentar.
- O `ServicoAutorizacao` serve a um cliente por instância. Para vários clientes, crie um por cliente (F2.2).
- As tentativas de login erradas ficam em memória (sem Valkey). Defina a persistência na F2.2.
- `topografia_tumor` (CID-O) está sem fonte.
- Tipos 4 e 5 de compatibilidade do SIGTAP: confirmar o significado na fonte oficial.
- 72 tabelas sem `estabelecimento_id`: revisar por módulo.
- 31 scripts do `package.json` citam o legado.

## Ambiente

- MariaDB `127.0.0.1:3410` e Oracle de referência, os dois no ar.
- Web `0.0.0.0:5310` e API `127.0.0.1:3310`, no ar.
- Certificado em `certs/`, fora do git.
- Vigia de disco: `tools/obra/vigia-disco.sh 130`. Havia 145 GB livres.
- Push: `git push origin main` usa o token do `.env` pelo `credential.helper` local.
