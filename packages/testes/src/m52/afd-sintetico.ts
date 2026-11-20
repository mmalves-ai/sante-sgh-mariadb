// Arquivos do relógio de ponto (AFD) SINTÉTICOS (M52.4; ficha, regra 12 e critério de aceite "os 5 arquivos sintéticos
// com defeito em quarentena"): um válido e cinco com um defeito cada (sequência quebrada, registro duplicado, CRC errado,
// contagem do registro final divergente e marcação repetida). O empregador e o relógio são de mentira e os CPF são os da
// lista sintética (nunca de pessoa real). Montados pelo leiaute do domínio (@sgh/dominio-pessoas).
import type { FalhaAfd } from '@sgh/contratos';
import { linhaCabecalhoAfd, linhaMarcacaoAfd, linhaTrailerAfd } from '@sgh/dominio-pessoas';

/** CPF da lista sintética do treino (tools/verificadores/dados/treino-sinteticos.txt). */
export const CPFS_AFD_SINTETICOS = ['12345678909', '11144477735'] as const;

export interface AfdSintetico {
  readonly nome: string;
  readonly descricao: string;
  readonly esperado: 'valido' | 'quarentena';
  readonly falha: FalhaAfd | null;
  readonly conteudo: string;
}

const CAB = linhaCabecalhoAfd({
  cnpj: '00000000000191',
  razaoSocial: 'HOSPITAL SINTETICO DE TESTE',
  numeroRep: '00004000000000777',
  dataInicial: '2026-09-01',
  dataFinal: '2026-09-30',
  geradoEm: '2026-10-01T06:00:00-0300',
});
const [A, B] = CPFS_AFD_SINTETICOS;
const marca = (nsr: number, quando: string, cpf: string) => linhaMarcacaoAfd(nsr, `${quando}:00-0300`, cpf);
const BASE = [
  marca(1, '2026-09-02T06:58', A),
  marca(2, '2026-09-02T19:02', A),
  marca(3, '2026-09-02T07:01', B),
  marca(4, '2026-09-02T19:00', B),
];
const arquivo = (linhas: readonly string[], tipo3 = linhas.length) =>
  [CAB, ...linhas, linhaTrailerAfd({ '3': tipo3 })].join('\r\n') + '\r\n';

export const ARQUIVOS_AFD_SINTETICOS: readonly AfdSintetico[] = [
  {
    nome: 'valido',
    descricao: 'quatro marcações de dois empregados, sequência e contagens certas',
    esperado: 'valido',
    falha: null,
    conteudo: arquivo(BASE),
  },
  {
    nome: 'sequencia-quebrada',
    descricao: 'o NSR pula do 2 para o 4',
    esperado: 'quarentena',
    falha: 'sequencia-quebrada',
    conteudo: arquivo([BASE[0]!, BASE[1]!, marca(4, '2026-09-02T07:01', B)]),
  },
  {
    nome: 'registro-duplicado',
    descricao: 'o NSR 2 aparece duas vezes',
    esperado: 'quarentena',
    falha: 'nsr-duplicado',
    conteudo: arquivo([BASE[0]!, BASE[1]!, marca(2, '2026-09-02T07:01', B)]),
  },
  {
    nome: 'crc-errado',
    descricao: 'uma linha com o código de verificação adulterado',
    esperado: 'quarentena',
    falha: 'crc',
    conteudo: arquivo([BASE[0]!, `${BASE[1]!.slice(0, -4)}0000`, BASE[2]!, BASE[3]!]),
  },
  {
    nome: 'trailer-divergente',
    descricao: 'o registro final declara 5 marcações e o arquivo tem 4',
    esperado: 'quarentena',
    falha: 'trailer-divergente',
    conteudo: arquivo(BASE, 5),
  },
  {
    nome: 'marcacao-repetida',
    descricao: 'a mesma marcação do mesmo empregado em dois registros',
    esperado: 'quarentena',
    falha: 'marcacao-duplicada',
    conteudo: arquivo([BASE[0]!, marca(2, '2026-09-02T06:58', A), BASE[2]!]),
  },
];
