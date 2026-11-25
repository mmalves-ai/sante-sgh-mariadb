#!/usr/bin/env bash
# Prova do usuário só leitura, pela rede interna, de um container temporário (só contagens e códigos de erro).
# Esperado: SELECT COUNT(*) em RDB$RELATIONS e numa tabela de usuário funcionam com a role LEITURA;
# CREATE TABLE e INSERT/DELETE são recusados. Termina em "RESULTADO: ok" ou lista o que falhou.
set -uo pipefail
IMG=firebirdsql/firebird:3.0.14-jammy
SEGREDOS=${FB_SIM_SEGREDOS:-/home/mmalves/workspace/redesante/sante-sgh-dados/segredos/fb-prontocardio.env}
set -a; . "$SEGREDOS"; set +a
export ISC_USER="$FB_SIM_LEITOR_USUARIO" ISC_PASSWORD="$FB_SIM_LEITOR_SENHA"
roda() { docker run --rm -i --network sante-sgh-conector-int -e ISC_USER -e ISC_PASSWORD --entrypoint /opt/firebird/bin/isql "$IMG" -q -role LEITURA fb-prontocardio/3050:prontocardio 2>&1; }
falhas=0
r=$(echo 'SELECT COUNT(*) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0;' | roda)
n=$(echo "$r" | grep -Eo '^[[:space:]]*[0-9]+[[:space:]]*$' | tr -d ' ' | head -1)
[ -n "$n" ] && echo "SELECT RDB\$RELATIONS: ok ($n tabelas/views de usuário)" || { echo "SELECT RDB\$RELATIONS: FALHOU"; falhas=1; }
T=$(echo "SELECT FIRST 1 TRIM(RDB\$RELATION_NAME) FROM RDB\$RELATIONS WHERE COALESCE(RDB\$SYSTEM_FLAG,0)=0 AND RDB\$VIEW_BLR IS NULL ORDER BY 1;" | roda | grep -v '^=\|^$\|TRIM' | head -1 | tr -d ' ')
r=$(echo "SELECT COUNT(*) FROM \"$T\" ROWS 1;" | roda); echo "$r" | grep -qi 'no permission\|Statement failed' \
  && { echo "SELECT numa tabela de usuário: FALHOU"; falhas=1; } || echo "SELECT numa tabela de usuário: ok"
r=$(echo "SELECT COUNT(*) FROM \"$T\" ROWS 1;" | docker run --rm -i --network sante-sgh-conector-int -e ISC_USER -e ISC_PASSWORD --entrypoint /opt/firebird/bin/isql "$IMG" -q fb-prontocardio/3050:prontocardio 2>&1)
echo "$r" | grep -qi 'no permission' && echo "SELECT sem a role LEITURA: recusado (ok)" || { echo "SELECT sem a role: NÃO recusado"; falhas=1; }
r=$(echo 'CREATE TABLE TESTE_LEITOR_DDL (X INTEGER);' | roda)
echo "$r" | grep -qi 'no privilege\|no permission' && echo "CREATE TABLE: recusado (ok)" || { echo "CREATE TABLE: NÃO recusado"; falhas=1; }
r=$(echo "INSERT INTO \"$T\" DEFAULT VALUES;" | roda)
echo "$r" | grep -qi 'no permission' && echo "INSERT: recusado por permissão (ok)" || { echo "INSERT: NÃO recusado por permissão"; falhas=1; }
r=$(echo "DELETE FROM \"$T\" WHERE 1=0;" | roda)
echo "$r" | grep -qi 'no permission' && echo "DELETE: recusado por permissão (ok)" || { echo "DELETE: NÃO recusado"; falhas=1; }
[ $falhas = 0 ] && echo "RESULTADO: ok" || echo "RESULTADO: FALHOU"
exit $falhas
