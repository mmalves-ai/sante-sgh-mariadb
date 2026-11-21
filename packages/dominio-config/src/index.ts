// Regras puras do módulo config (M08): CRUD genérico, parâmetros do sistema novo e funcionalidades por
// estabelecimento (POL-3). Sem Nest, banco ou HTTP; só @sgh/contratos.
export * from './dominio/declaracao.js';
export * from './dominio/duplicidade.js';
export * from './dominio/lista.js';
export * from './dominio/exportar.js';
export * from './dominio/inativar.js';
export * from './dominio/versao.js';
export * from './parametros/resolver.js';
export * from './parametros/vigencia.js';
export * from './liberacao/prerequisito-chave.js';
export * from './liberacao/lote.js';
export * from './liberacao/recurso.js';
export * from './liberacao/catalogo-operacoes.js';
// M61: liberação full na instalação (planejador do comando liberacao:ligar-tudo) e as conferências ao ligar (API e comando).
export * from './liberacao/liberacao-full.js';
export * from './liberacao/conferencias-ligar.js';
export * from './consulta/consulta.js';
export * from './prontidao/prontidao.js';
export * from './prontidao/documentos.js';
export * from './homologacao/homologacao.js';
// M43: fim da coexistência por hospital (regras 1 a 5 e 7: critério, sessões no sistema anterior, sem grupo, painéis).
export * from './fim-coexistencia/sem-sessao.js';
export * from './fim-coexistencia/usuarios-restantes.js';
export * from './fim-coexistencia/criterio.js';
export * from './fim-coexistencia/atraso.js';
export * from './fim-coexistencia/montagem.js';
// M37: painel de migração gradual, treinamento e governança (regras 1, 2, 3, 3a, 6, 7, 9 e 10).
export * from './coexistencia/ultima-conexao.js';
export * from './coexistencia/acesso-apos-trilha.js';
export * from './coexistencia/parcela.js';
export * from './coexistencia/setor-migrado.js';
export * from './coexistencia/conducao.js';
export * from './coexistencia/setores.js';
export * from './coexistencia/relatorio.js';
export * from './chamado/prazos.js';
// M38: onda 0 (estado das operações, primeira liberação, escopo e vigilância de gravação em produção).
export * from './onda0/onda0.js';
export * from './onda0/linha-de-base.js';
export * from './onda0/vigia.js';
export * from './onda0/telas.js';
// M39: onda 1 (cadastros, agenda, call center, recepção ambulatorial e painéis).
export * from './onda1/onda1.js';
export * from './onda1/vigia.js';
export * from './onda2/onda2.js';
// M41: onda 3 (farmácia, dispensação, almoxarifado e compras).
export * from './onda3/onda3.js';
// M42: onda 4 (faturamento, auditoria de contas, TISS, glosa e recurso, financeiro e repasse).
export * from './onda4/onda4.js';
// M58: desligamento do outro sistema, Firebird 5 e UTF-8 (sessões, inventário, plataforma do banco e ordem dos passos).
export * from './desligamento/sessoes.js';
export * from './desligamento/inventario.js';
export * from './desligamento/plataforma.js';
export * from './desligamento/passos.js';
export * from './desligamento/montagem.js';
// M60-F2: conferência da instalação e da conexão ao banco.
export * from './implantacao/conferencia.js';
// M60-F3: fumaça do servidor e verificação pós-implantação.
export * from './implantacao/fumaca.js';
export * from './implantacao/hora-confiavel.js';
export * from './implantacao/verificacao.js';
export * from './desligamento/ensaio-firebird5.js';
export * from './desligamento/ensaio-utf8.js';
export * from './desligamento/janela.js';
// M59-F6: decisão sobre a retrocompatibilidade e plano de evolução do modelo (ADR 0033).
export * from './desligamento/retrocompatibilidade.js';
