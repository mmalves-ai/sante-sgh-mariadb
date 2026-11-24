-- Agenda, cadastro único de feriados e dias não úteis (F3.1, 02-CAD linha 28, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
-- Decisão: havia duas tabelas para o mesmo assunto, `feriado` (só data, sem recorrência nem faixa do dia) e
-- `dia_nao_util` (abrangência com a UF por id, recorrência anual, data única ou móvel, ponto facultativo e faixa do
-- dia). Fica `dia_nao_util` como o cadastro único: a tela e a API do calendário gravam só nela, e a agenda de consultas
-- e a de exames leem por um leitor comum. `feriado` fica congelada (nada do produto grava nela): esta migração copia o
-- que existir para `dia_nao_util` (data única; a sigla da UF vira o id; a linha já excluída não vem; a linha inativa
-- vem inativa), e o leitor comum da agenda e dos exames deixa de ler `feriado`: o que se inativa ou altera no
-- Calendário vale na hora. O feriado estadual sem UF não tem alvo e não vem (o leitor anterior também nunca o aplicava,
-- porque a UF nula não casa com a do estabelecimento). A tabela sai quando os leitores restantes (acréscimo de feriado
-- da conta, ponto, portal do paciente e prazos da qualidade) passarem ao leitor comum.
INSERT INTO dia_nao_util (descricao, abrangencia, unidade_federativa_id, municipio_ibge_id, estabelecimento_id,
                          recorrencia, data, facultativo, ativo, origem, criado_em, criado_por, versao)
SELECT f.nome, f.abrangencia, CASE WHEN f.abrangencia = 'estadual' THEN u.id END,
       CASE WHEN f.abrangencia = 'municipal' THEN f.municipio_ibge_id END,
       CASE WHEN f.abrangencia = 'estabelecimento' THEN f.estabelecimento_id END,
       'data_unica', f.data, f.ponto_facultativo, f.ativo, 'sistema', UTC_TIMESTAMP(3), f.criado_por, 1
  FROM feriado f
  LEFT JOIN unidade_federativa u ON u.sigla = f.uf
 WHERE f.excluido_em IS NULL
   AND (f.abrangencia <> 'estadual' OR u.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM dia_nao_util d
      WHERE d.recorrencia = 'data_unica' AND d.data = f.data AND d.descricao = f.nome AND d.abrangencia = f.abrangencia
        AND d.unidade_federativa_id <=> CASE WHEN f.abrangencia = 'estadual' THEN u.id END
        AND d.municipio_ibge_id <=> CASE WHEN f.abrangencia = 'municipal' THEN f.municipio_ibge_id END
        AND d.estabelecimento_id <=> CASE WHEN f.abrangencia = 'estabelecimento' THEN f.estabelecimento_id END);

ALTER TABLE feriado COMMENT = 'Congelada: substituída pelo cadastro único dia_nao_util (05_AGE/90); só leitura até sair';
