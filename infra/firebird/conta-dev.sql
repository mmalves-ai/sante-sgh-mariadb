-- Conta própria do Sante SGH na CÓPIA de dev (pendência do M01 e do M02; DP-15; roteiro, seção 4.4).
-- Redigido pela IA; EXECUTADO POR PESSOA (dono ou TI), como SYSDBA, dentro do container da cópia
-- (redesante-fb-<código>, nunca o sante-firebird). Concede só LEITURA (GRANT SELECT) às tabelas e visões
-- do legado; nenhum objeto do legado é criado, alterado ou removido. As tabelas SGH_ ficam de fora (têm
-- script próprio). Exceção prevista do guardas:legado do M04, regra (c): script de privilégio executado
-- por pessoa, fora do código da aplicação.
-- Depois de executar: FB_<COD>_USUARIO=SGH_DEV e FB_<COD>_SENHA=<a senha escolhida> no .env.sante, e
-- retire SGH_DEV_PERMITIR_SYSDBA=sim dos scripts do package.json e do ambiente (o núcleo passa a recusar
-- a conta de administrador sem exceção).
--
-- Uso (exemplo, cópia pc):
--   docker exec -i redesante-fb-pc /opt/firebird/bin/isql -user SYSDBA -password "<senha do SYSDBA>" \
--     localhost:/var/lib/firebird/data/pc.fdb < infra/firebird/conta-dev.sql
-- Troque <SENHA_SGH_DEV> antes (não versione o arquivo com a senha preenchida).
--
-- Escopo desta versão (M02): só leitura de todas as tabelas e visões do legado. O executor do M04 pede,
-- operação por operação, os privilégios de escrita (script próprio, também executado por pessoa).

SET TERM ^ ;

CREATE USER SGH_DEV PASSWORD '<SENHA_SGH_DEV>' USING PLUGIN Srp^

EXECUTE BLOCK AS
  DECLARE VARIABLE t VARCHAR(63);
BEGIN
  FOR SELECT TRIM(r.RDB$RELATION_NAME) FROM RDB$RELATIONS r
       WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND r.RDB$RELATION_NAME NOT STARTING WITH 'SGH_'
       INTO :t
  DO
    EXECUTE STATEMENT 'GRANT SELECT ON "' || :t || '" TO USER SGH_DEV';
END^

SET TERM ; ^
COMMIT;
