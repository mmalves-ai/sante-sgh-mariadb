// W0-02 (D-CRUD-SEM-GATILHO): o parâmetro que liga a vigia de reconciliação do motor do CRUD genérico. Os gatilhos
// AFTER DELETE que a matriz recomenda não são criados no banco (regra-mãe da convivência); a vigia compara contagem e
// checksum das tabelas de domínio e gera o relatório "exclusões feitas fora do Sante". Desligada por padrão: o
// estabelecimento (ou a rede) liga; no desenvolvimento, a integração liga na transação desfeita.
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETROS_CRUD: readonly DefinicaoParametro[] = [
  {
    chave: 'crud.vigiaReconciliacao',
    modulo: 'crud',
    descricao:
      'Ligar a vigia de reconciliação dos cadastros (contagem e checksum por tabela de domínio; relatório das exclusões feitas fora do Sante)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'Administração do sistema',
    origem: 'W0-02 (programa CRUD completo): D-CRUD-SEM-GATILHO, no lugar dos gatilhos AFTER DELETE',
  },
];
