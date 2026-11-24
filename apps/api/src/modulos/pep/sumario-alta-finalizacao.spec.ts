// F3.3 (linha 03-PEP L124): a finalização do sumário de alta pelo serviço segue as seções configuradas do atendimento
// conferido. Porta de documentos EM MEMÓRIA (paciente 1003, atendimento 10031, SINTÉTICOS); as seções chegam pelo
// resolvedor, como o controlador as entrega a partir da porta própria. Prova: a seção obrigatória vazia recusa com o
// campo da seção; a seção inativa (fora das vigentes) não entra; com texto, a entrada da gravação leva o texto nas
// seções, na ordem e com o título do cadastro; o atendimento de outro paciente é recusado antes de ler as seções.
import { esquemaSalvarSumario, type SalvarSumario } from '@sgh/contratos';
import type { SecaoVigente } from '@sgh/dominio-pep';
import { describe, expect, it } from 'vitest';
import type { ContextoDocs } from './documentos-porta.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import { ServicoDocumentos } from './documentos-servico.js';

const c: ContextoDocs = { cliente: 'demo', correlacao: 'l124-fin', rede: 'REDE', hospital: 'HOSP' };
const secao = (
  x: Partial<SecaoVigente> & Pick<SecaoVigente, 'codigo' | 'tipoConteudo' | 'ordem'>,
): SecaoVigente => ({
  descricao: x.codigo,
  obrigatorio: false,
  periodo: null,
  origem: 'estabelecimento',
  ...x,
});
const SECOES: readonly SecaoVigente[] = [
  secao({
    codigo: 'diagnosticos',
    tipoConteudo: 'diagnosticos',
    descricao: 'Hipóteses diagnósticas',
    ordem: 1,
  }),
  secao({
    codigo: 'l124-orient',
    tipoConteudo: 'orientacoes',
    descricao: 'Orientações ao paciente',
    ordem: 2,
    obrigatorio: true,
  }),
];

async function preparar() {
  const porta = new PortaDocumentosMemoria();
  const servico = new ServicoDocumentos(porta);
  const prof = servico.exigirProfissional(await porta.profissional(c, 'SINT.MEDICO'));
  const pedidos: number[] = [];
  const resolver = async (atd: number) => {
    pedidos.push(atd);
    return SECOES;
  };
  return { servico, prof, pedidos, resolver };
}

const base = (sumario: Record<string, unknown>): SalvarSumario =>
  esquemaSalvarSumario.parse({ atendimento: 10031, versao: 0, sumario });
const DIAG = [{ cid: 'I20', descricao: 'Angina' }];

async function problema(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const x = e as { status?: number; getStatus?: () => number; extras?: Record<string, unknown> };
    return { status: x.status ?? x.getStatus?.() ?? -1, campos: (x.extras?.['campos'] ?? []) as string[] };
  }
  throw new Error('Era para recusar.');
}

describe('finalização do sumário de alta pelas seções do atendimento (serviço)', () => {
  it('a seção obrigatória vazia recusa com o campo da seção, e o diagnóstico é o piso legal', async () => {
    const { servico, prof, pedidos, resolver } = await preparar();
    const r = await problema(
      servico.montarFinalizacao(
        c,
        1003,
        base({ diagnosticos: [] }),
        prof,
        'SINT.MEDICO',
        { comoSuporte: false },
        resolver,
      ),
    );
    expect(r.status).toBe(400);
    expect(r.campos).toEqual(['diagnosticos', 'secao.l124-orient']);
    expect(pedidos).toEqual([10031]);
  });

  it('com o texto da obrigatória, a entrada da gravação leva as seções na ordem e com o título do cadastro', async () => {
    const { servico, prof, resolver } = await preparar();
    const e = await servico.montarFinalizacao(
      c,
      1003,
      base({
        diagnosticos: DIAG,
        secoes: [
          { codigo: 'l124-orient', texto: 'Repouso relativo' },
          { codigo: 'retirada', texto: 'fora' },
        ],
      }),
      prof,
      'SINT.MEDICO',
      { comoSuporte: false },
      resolver,
    );
    expect(e.atendimento).toBe(10031);
    expect(e.versao).toBe(1);
    const gravado = JSON.parse(e.sumario) as { secoes?: { codigo: string; texto: string }[] };
    expect(gravado.secoes?.map((s) => s.codigo)).toEqual(['l124-orient']);
    expect(e.documento).toContain('Orientações ao paciente');
    expect(e.documento).toContain('Repouso relativo');
    expect(e.documento.indexOf('Hipóteses diagnósticas')).toBeLessThan(
      e.documento.indexOf('Orientações ao paciente'),
    );
  });

  it('o atendimento de outro paciente é recusado antes de ler as seções', async () => {
    const { servico, prof, pedidos, resolver } = await preparar();
    const r = await problema(
      servico.montarFinalizacao(
        c,
        1001,
        base({ diagnosticos: DIAG }),
        prof,
        'SINT.MEDICO',
        { comoSuporte: false },
        resolver,
      ),
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(pedidos).toEqual([]);
  });
});
