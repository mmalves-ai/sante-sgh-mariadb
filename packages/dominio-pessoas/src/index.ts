// @sgh/dominio-pessoas (M52): regras puras da gestão de pessoas, sem banco nem Nest. Fatia F1: CPF do colaborador,
// uma pessoa com vários vínculos (regra 1), desligamento ligado ao acesso (regra 2), validade do conselho e o
// bloqueio do vencido na escala (regra 3), a situação do cadastro de profissionais (regra 4) e o histórico funcional.
// Fatia F2: regimes, montagem e publicação da escala (regras 3 e 5 a 8, cobertura mínima). Fatia F3: troca de plantão
// (regra 8, segunda parte), quem está de plantão agora com o sobreaviso (regra 10) e o dimensionamento COFEN 543 (regra 9).
// A API relê o estado dentro da transação e as receitas de gravação (@sgh/legado) conferem de novo no banco.
export * from './datas.js';
// M53-F1: vigência das rubricas e das tabelas legais (regra 7) e a conferência das incidências com o eSocial.
export * from './folha/vigencia.js';
export * from './folha/incidencias.js';
export * from './colaborador/cpf.js';
export * from './colaborador/vinculo.js';
export * from './colaborador/situacao-legada.js';
export * from './colaborador/desligamento.js';
export * from './colaborador/historico.js';
export * from './colaborador/ficha-admissao.js';
export * from './colaborador/experiencia.js';
export * from './habilitacao/validade.js';
export * from './escala/conselho-vencido.js';
export * from './escala/tempo.js';
export * from './escala/plantao.js';
export * from './escala/interjornada.js';
export * from './escala/limite-contrato.js';
export * from './escala/sobreposicao.js';
export * from './escala/cobertura.js';
export * from './escala/publicacao.js';
export * from './escala/montagem.js';
export * from './escala/regime.js';
// Fatia F5 (M52.5): SESMT (ASO e PCMSO, vacinas, acidente e CAT, riscos e EPI, dosimetria; regras 17 a 19).
export * from './sesmt/recusa.js';
export * from './sesmt/aso.js';
export * from './sesmt/vacina.js';
export * from './sesmt/cat.js';
export * from './sesmt/epi.js';
export * from './sesmt/ppp.js';
export * from './sesmt/pendencias.js';
export * from './escala/troca.js';
export * from './escala/plantao-agora.js';
export * from './dimensionamento/cofen-543.js';
export * from './indicadores/indicadores-pessoas.js';
// Fatia F4 (M52.4): ponto (AFD, ajustes, apuração, banco de horas, fechamento e ciência, AEJ; regras 11 a 15).
export * from './ponto/afd.js';
export * from './ponto/ajuste.js';
export * from './ponto/apuracao.js';
export * from './ponto/banco-horas.js';
export * from './ponto/fechamento.js';
export * from './ponto/aej.js';
export * from './ponto/biometria.js';
// Fatia F6 (M52.6): treinamentos e ciência de POP (regra 20), autosserviço (regra 21), plantão realizado para o repasse.
export * from './treinamento/validade.js';
export * from './treinamento/pop.js';
export * from './autoatendimento/escopo.js';
export * from './autoatendimento/solicitacao.js';
export * from './escala/realizado.js';
export * from './escala/regra-plantao.js';
// M53-F0: conferência dos lotes trocados com a folha externa, dono de cada dado na interface e exportação do ponto.
export * from './folha/lote.js';
export * from './folha/dono-do-dado.js';
export * from './ponto/exportacao.js';
export * from './folha/exportacao.js';
export * from './folha/afastamento.js';
// M53-F2: cálculo mensal da folha (regras puras, memória e prova da soma).
export * from './folha/calculo.js';
export * from './folha/paralelo.js';
// M53-F3: férias e 13º (períodos aquisitivos, programação, recibo, parcelas do 13º, médias e avos).
export * from './folha/medias.js';
export * from './folha/recibo.js';
export * from './folha/ferias.js';
export * from './folha/decimo-terceiro.js';
// M53-F4: rescisão (modalidade, aviso, projeção, férias e 13º proporcionais, multa do FGTS).
export * from './folha/rescisao.js';
export * from './folha/fechamento.js';
// M53-F8: títulos e fatos contábeis da folha (plano, vencimentos, documento, custo de pessoal por centro de custo).
export * from './folha/titulos.js';
// M53-F5: eSocial de tabela e não periódicos (montagem do XML, XSD oficial, transmissor único, conciliação, ciclo).
export * from './esocial/xml.js';
export * from './esocial/comum.js';
export * from './esocial/eventos-tabela.js';
export * from './esocial/eventos-trabalhador.js';
export * from './esocial/eventos-sst.js';
export * from './esocial/eventos-periodicos.js';
export * from './esocial/transmissor-unico.js';
export * from './esocial/ciclo.js';
export * from './esocial/xsd.js';
// M53-F7: FGTS Digital e obrigações legais (regimes com vigência, apuração e conciliação do FGTS, SEFIP, CAGED, RAIS).
export * from './obrigacoes/leiaute-fixo.js';
export * from './obrigacoes/regime.js';
export * from './obrigacoes/fgts-digital.js';
export * from './obrigacoes/tipos.js';
export * from './obrigacoes/correspondencias.js';
export * from './obrigacoes/remuneracao.js';
export * from './obrigacoes/sefip.js';
export * from './obrigacoes/caged.js';
export * from './obrigacoes/rais.js';
