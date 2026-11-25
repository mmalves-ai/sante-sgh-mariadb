# Firebird simulado (leitura direta em dev)

Simula, nesta VM, o servidor Firebird vivo de um hospital, para o conector ler direto (ADR 0010).

| Item | Valor |
|---|---|
| Container | `sante-sgh-fb-prontocardio` (`firebirdsql/firebird:3.0.14-jammy`, `--restart unless-stopped`) |
| Base | volume `sante-sgh-fb-prontocardio-data`, arquivo `/prontocardio.fdb` (cópia já conferida; os scripts nunca copiam nem apagam) |
| Alias | `prontocardio` (`databases.conf` desta pasta, copiado pelo `subir.sh` para `sante-sgh-dados/firebird-simulado/` e montado de lá `:ro`, fora de qualquer worktree; container com o bind de outro lugar é recriado) |
| Rede | interna `sante-sgh-conector-int`, alias `fb-prontocardio`, porta 3050; host em `127.0.0.1:3354` pela rede `sante-sgh-fb-loopback` (sem NAT de saída; rede interna não publica porta) |
| DSN do conector | `fb-prontocardio/3050:prontocardio`, role `LEITURA` |
| Segredos | `sante-sgh-dados/segredos/fb-prontocardio.env` (`FB_SIM_SYSDBA_SENHA`, `FB_SIM_LEITOR_USUARIO`, `FB_SIM_LEITOR_SENHA`); nunca impressos |

Sem `gfix read_only`: simula servidor em uso. A proteção é do usuário e da transação:
- o leitor só tem `SELECT`, pela role `LEITURA` (todas as tabelas e views sem `SYSTEM_FLAG`);
- no Firebird 3 não existe role padrão (`GRANT DEFAULT` é do 4): o cliente **conecta com role `LEITURA`**;
  sem ela o leitor não lê tabela de usuário;
- DDL, `INSERT` e `DELETE` são recusados pelo servidor;
- o conector ainda abre transação `SNAPSHOT` + `READ` (somente leitura).

## Uso
```
flock ../../../sante-sgh-dados/obra/pesado.lock ./subir.sh   # idempotente: cria/sobe, usuário, role e GRANTs
./conferir.sh                                               # prova pela rede interna; termina em "RESULTADO: ok"
./parar.sh                                                  # para; ./parar.sh --remover remove o container
```
Descartar tudo (só com autorização do dono, apaga a cópia de ~48 GB): `./parar.sh --remover` e depois
`docker volume rm sante-sgh-fb-prontocardio-data`.

Os GRANTs ficam na própria base; o usuário fica no banco de segurança do container. Recriar o container
exige rodar o `subir.sh` de novo, que refaz tudo.
