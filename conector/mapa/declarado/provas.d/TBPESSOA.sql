SELECT doc, tipo FROM (
  SELECT pf.cpf AS doc, 'F' AS tipo FROM pessoa_fisica pf
   WHERE pf.excluido_em IS NULL AND pf.cpf IS NOT NULL
     AND EXISTS (SELECT 1 FROM {ctl}.conector_origem co
                  WHERE co.entidade_destino = 'pessoa_fisica' AND co.id_destino = pf.id AND co.excluido_em IS NULL)
  UNION
  SELECT pj.cnpj AS doc, 'J' AS tipo FROM pessoa_juridica pj
   WHERE pj.excluido_em IS NULL AND pj.cnpj IS NOT NULL
     AND EXISTS (SELECT 1 FROM {ctl}.conector_origem co
                  WHERE co.entidade_destino = 'pessoa_juridica' AND co.id_destino = pj.id AND co.excluido_em IS NULL)
  UNION
  SELECT pf.cpf AS doc, 'F' AS tipo FROM pessoa_fisica pf
   WHERE pf.excluido_em IS NULL AND pf.cpf IS NOT NULL
     AND (EXISTS (SELECT 1 FROM profissional p
                    JOIN {ctl}.conector_origem co ON co.id_destino = p.id AND co.entidade_destino = 'profissional'
                     AND co.excluido_em IS NULL
                   WHERE p.pessoa_fisica_id = pf.id AND p.excluido_em IS NULL)
       OR EXISTS (SELECT 1 FROM empresa_fornecedora f
                    JOIN {ctl}.conector_origem co ON co.id_destino = f.id AND co.entidade_destino = 'empresa_fornecedora'
                     AND co.excluido_em IS NULL
                   WHERE f.pessoa_fisica_id = pf.id AND f.excluido_em IS NULL)
       OR EXISTS (SELECT 1 FROM beneficiario_plano b
                    JOIN {ctl}.conector_origem co ON co.id_destino = b.id AND co.entidade_destino = 'beneficiario_plano'
                     AND co.excluido_em IS NULL
                   WHERE b.pessoa_fisica_id = pf.id)
       OR EXISTS (SELECT 1 FROM mantenedora m
                    JOIN {ctl}.conector_origem co ON co.id_destino = m.id AND co.entidade_destino = 'mantenedora'
                     AND co.excluido_em IS NULL
                   WHERE m.responsavel_pessoa_fisica_id = pf.id))
  UNION
  SELECT pj.cnpj AS doc, 'J' AS tipo FROM pessoa_juridica pj
   WHERE pj.excluido_em IS NULL AND pj.cnpj IS NOT NULL
     AND (EXISTS (SELECT 1 FROM profissional p
                    JOIN {ctl}.conector_origem co ON co.id_destino = p.id AND co.entidade_destino = 'profissional'
                     AND co.excluido_em IS NULL
                   WHERE p.pessoa_juridica_id = pj.id AND p.excluido_em IS NULL)
       OR EXISTS (SELECT 1 FROM empresa_fornecedora f
                    JOIN {ctl}.conector_origem co ON co.id_destino = f.id AND co.entidade_destino = 'empresa_fornecedora'
                     AND co.excluido_em IS NULL
                   WHERE f.pessoa_juridica_id = pj.id AND f.excluido_em IS NULL)
       OR EXISTS (SELECT 1 FROM mantenedora m
                    JOIN {ctl}.conector_origem co ON co.id_destino = m.id AND co.entidade_destino = 'mantenedora'
                     AND co.excluido_em IS NULL
                   WHERE m.pessoa_juridica_id = pj.id))
) identidade
