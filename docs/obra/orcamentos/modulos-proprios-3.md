# Orçamento: modulos-proprios-3

estimativa_M: 60
teto_M: 78

- **Recontagem (24/11, 02h15, integradores da modulos-proprios-2):** restam no banco próprio cerca de 92 métodos:
  gestão da qualidade ~49 (historicoRiscos e as metades C 26 e D 22), SUS 14 montagens (dadosCiha, dadosBpa,
  linhasBpa, linhasApac, atendimentoLaudoApac, dominiosApac, buscarSolicitantesApac, solicitantesApacPorChave,
  linhaBpaDaCompetencia, internacaoAih, internacoesSus, dadosAih, lotesSaida; montagemLeProducao()=false), folha 12
  (obrigações e férias), PEP 4 (anexarDocumento, solicitarExame, gravarRegra, registrarFicha), SAE 4, cadastro 1,
  pessoas 1; acesso por e-mail construído e não ligado (recuperação, troca rápida, segundo fator por e-mail, rotas,
  tela). Testes de integração de SUS, qualidade e PEP da rodada 2 ainda não rodados.
- **Defeito de regra achado pelo orquestrador (verificar:tudo, sem-coexistencia):** o PEP recusa salvar/descartar
  rascunho cuja origem não é 'sistema' ("Rascunho começado no outro sistema", só leitura): regra da convivência do
  new-sgh, contrária ao ADR 0006 (importação é continuidade: o rascunho importado volta ao autor, que pode finalizá-lo
  ou apagá-lo). Família própria, prioritária.
- **Decisão do orquestrador (SUS):** reapresentação da AIH na mesma competência recusa com erro de domínio claro
  (409, sem erro cru de banco); em competência nova, segue a regra da memória.
- **Agentes:** 10 construtores × 2,7; 10 revisores × 0,6; 10 corretores × 1,1; 2 integradores × 3. Soma 50 M × 1,2 =
  **60 M**; teto **78 M**.
