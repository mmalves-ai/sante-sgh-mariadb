# infra/compose

`dev.yml` (M01): Valkey (63718), S3 compatível provisório (SeaweedFS; 9318 API e 9319 interface web; a
edição definitiva sai do spike do M09), Gotenberg (3318), Mailpit (8325 web, 1325 SMTP) e Grafana (3330).
Projeto Compose `sgh`; containers, rede e volumes com prefixo `sgh-`; tudo em `127.0.0.1`; imagens por tag
exata e digest; `healthcheck` em todos; telemetria e checagem de versão desligadas.

- `./pnpm infra:subir`: confere antes a configuração resolvida (portas só em `127.0.0.1`, fora das
  ocupadas, nomes `sgh-`, digest, healthcheck, nenhum Firebird) e as portas já publicadas por outros
  containers; sobe com `--env-file .env.sante` e espera todos ficarem `healthy`.
- `./pnpm infra:descer`: para e remove os containers e a rede; **os volumes ficam**.

O Firebird não entra aqui: a cópia de dev é a compartilhada de `../banco-dev` (ver `infra/firebird`).
