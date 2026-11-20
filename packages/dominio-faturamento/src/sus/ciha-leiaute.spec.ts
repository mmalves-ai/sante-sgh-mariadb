// Arquivo CIHA sintético contra o leiaute oficial do CIHA01 (1.0.4.0): posições e tamanhos do documento, estrutura
// (0 erro), registros 2, 4 e 5, remessa sem movimento e o mesmo conjunto dando o mesmo conteúdo.
import { describe, expect, it } from 'vitest';
import { montarCiha } from './ciha.js';
import { gerarArquivoCiha, LEIAUTE_CIHA01 } from './ciha-leiaute.js';
import { conferirEstrutura, FIM_DE_LINHA, lerLinha, tamanhoDoRegistro } from './leiaute.js';
import { atendimento, CATALOGO, contexto } from './massa.spec-util.js';

/** Posição inicial (1-based) e tamanho de cada campo, como o documento oficial lista. */
function posicoes(tipo: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  let i = 1;
  for (const c of LEIAUTE_CIHA01.registros[tipo]!.campos) {
    out[c.nome] = [i, c.tamanho];
    i += c.tamanho;
  }
  return out;
}

describe('arquivo CIHA (leiaute oficial do CIHA01 1.0.4.0)', () => {
  it('o descritor bate com as posições do documento oficial', () => {
    expect(tamanhoDoRegistro(LEIAUTE_CIHA01.registros['1']!)).toBe(15);
    for (const t of ['2', '3', '4', '5']) expect(tamanhoDoRegistro(LEIAUTE_CIHA01.registros[t]!)).toBe(390);
    const p = posicoes('2');
    // Amostra do documento: NOME_PAC 2/60, COD_MUNIC 107/6, DT_NASC 123/8, CNS 132/15, PROC_REA 147/10,
    // DIAG_PRIN 157/4, DT_ATENDIMENTO 165/8, DT_ALTA 173/8, TP_ALTA 181/2, TP_FREMU 183/2, DS_PROC 185/40,
    // REG_ANS 225/6, CNPJ_OPER 231/14, CO_BENEF 245/30, NU_OBITO 275/11, NU_NASC 286/1, NU_DN1 287/11,
    // QT_UTI 342/3, NU_PRONT 345/12, DT_CMPT 357/6, QTD_ATENDIMENTO 363/6, CO_MODALIDADE 369/2, NU_TISS 371/20.
    expect(p).toMatchObject({
      nome: [2, 60],
      municipio: [107, 6],
      nascimento: [123, 8],
      cns: [132, 15],
      procedimento: [147, 10],
      cidPrincipal: [157, 4],
      atendimento: [165, 8],
      alta: [173, 8],
      motivoAlta: [181, 2],
      fonte: [183, 2],
      descricaoProcedimento: [185, 40],
      regAns: [225, 6],
      cnpj: [231, 14],
      beneficiario: [245, 30],
      obito: [275, 11],
      nascidos: [286, 1],
      dn1: [287, 11],
      diasUti: [342, 3],
      prontuario: [345, 12],
      competencia: [357, 6],
      quantidade: [363, 6],
      modalidade: [369, 2],
      guiaTiss: [371, 20],
    });
    expect(LEIAUTE_CIHA01.conferidoContraOficial).toBe(true);
  });

  it('header, internação (2), ambulatorial (4) e consolidado (5), sem erro de estrutura', () => {
    const ctx = contexto({
      procedimento: (id) => {
        const p = CATALOGO.get(id);
        if (!p) return null;
        const registros = id === 103 ? [] : id === 101 ? (['bpa-i'] as const) : (['bpa-c'] as const);
        return { procedimento: p, naCompetencia: { fonte: 'atual', atributos: p.atuais }, registros };
      },
    });
    const { registros, criticas } = montarCiha(
      [
        atendimento({ itens: [{ item: 1, sigtap: 101, quantidade: 2 }] }),
        atendimento({
          modalidade: 'internacao',
          convenio: 10,
          entrada: '2025-09-01',
          saida: '2025-09-03',
          itens: [{ item: 3, sigtap: 101, quantidade: 3 }],
        }),
        atendimento({ convenio: 10, itens: [{ item: 4, sigtap: 102, quantidade: 1 }] }),
        atendimento({ convenio: 10, itens: [{ item: 5, sigtap: 102, quantidade: 1 }] }),
      ],
      ctx,
    );
    expect(criticas).toEqual([]);
    const a = gerarArquivoCiha('202509', '9999991', registros);
    expect(a).toMatchObject({
      nomeArquivo: 'CIHA_9999991_202509.TXT',
      linhas: 4,
      registros: 4,
      procedimentos: 3,
      semMovimento: false,
      leiaute: 'CIHA01',
      versaoLeiaute: '1.0.4.0',
      conferidoContraOficial: true,
    });
    expect(conferirEstrutura(LEIAUTE_CIHA01, a.conteudo)).toEqual([]);
    const linhas = a.conteudo.split(FIM_DE_LINHA);
    expect(linhas[0]).toBe('199999911.0.4.0');
    const amb = lerLinha(LEIAUTE_CIHA01, '4', linhas[1]!);
    expect(amb).toMatchObject({
      tipo: '4',
      nascimento: '10051990',
      sexo: 'F',
      procedimento: '0301010072',
      atendimento: '10092025',
      alta: ' '.repeat(8),
      motivoAlta: '  ',
      fonte: '01',
      regAns: '123456',
      competencia: '092025',
      quantidade: '000002',
      modalidade: '01',
      cns: ' '.repeat(15),
    });
    expect(amb['beneficiario']!.trim()).toBe('CARTEIRA-SINT-1');
    const internacao = lerLinha(LEIAUTE_CIHA01, '2', linhas[2]!);
    expect(internacao).toMatchObject({
      tipo: '2',
      atendimento: '01092025',
      alta: '03092025',
      motivoAlta: '12',
      fonte: '03',
      regAns: ' '.repeat(6),
      quantidade: '000001',
      modalidade: '02',
    });
    expect(internacao['beneficiario']!.trim()).toBe('');
    // As duas fichas do particular com o procedimento de BPA consolidado viram uma linha 5 com a soma.
    expect(lerLinha(LEIAUTE_CIHA01, '5', linhas[3]!)).toMatchObject({
      tipo: '5',
      procedimento: '0310010039',
      fonte: '03',
      competencia: '092025',
      quantidade: '000002',
      nome: ' '.repeat(60),
    });
    expect(gerarArquivoCiha('202509', '9999991', registros).conteudo).toBe(a.conteudo);
  });

  it('sem registro: remessa "sem movimento" com o header e a linha do tipo 3', () => {
    const a = gerarArquivoCiha('202509', 3132471, []);
    expect(a).toMatchObject({
      linhas: 2,
      registros: 0,
      procedimentos: 0,
      semMovimento: true,
      nomeArquivo: 'CIHA_3132471_202509.TXT',
    });
    const [h, d] = a.conteudo.split(FIM_DE_LINHA);
    expect(h).toBe('131324711.0.4.0');
    expect(d).toBe(`3${' '.repeat(389)}`);
    expect(conferirEstrutura(LEIAUTE_CIHA01, a.conteudo)).toEqual([]);
  });

  it('texto maior que o campo é cortado (nome do cadastro tem 70 caracteres; o leiaute, 60)', () => {
    const base = atendimento();
    const { registros } = montarCiha(
      [atendimento({ paciente: { ...base.paciente, nome: 'N'.repeat(70), numero: '123456' } })],
      contexto(),
    );
    const a = gerarArquivoCiha('202509', '9999991', registros);
    expect(conferirEstrutura(LEIAUTE_CIHA01, a.conteudo)).toEqual([]);
    const l = lerLinha(LEIAUTE_CIHA01, '4', a.conteudo.split(FIM_DE_LINHA)[1]!);
    expect(l['nome']).toBe('N'.repeat(60));
    expect(l['numero']).toBe('12345');
  });
});
