// M44 (ficha, seção 5; regra 7): o formulário de classificação do prontuário (E08) pela classificação de risco. Hoje o
// modelo está fora da liberação do registro clínico (D-LIB-2 do M22): a tela avisa e a classificação fica só neste
// sistema (POL-3). A gravação, quando ligada, monta as respostas pelo motor e chama o registro clínico com a
// classificação na mesma transação (a composição é provada pelas assinaturas e08-* na cópia). Fakes sintéticos.
import { describe, expect, it } from 'vitest';
import { formularioDaSessao } from './classificacao-formulario.js';
import { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { ServicoRegistro } from '../pep/public-api.js';
import { PROTOCOLO_SINTETICO } from '@sgh/dominio-recepcao';

const sessao = {
  req: { sgh: { sessao: { unidadeAtiva: null } } },
  hospital: 'aa',
  rede: 'rede',
  login: 'SINT.ENFERMEIRO.PA',
  porta: { rede: 'rede', hospital: 'aa' },
  pode: () => true,
} as unknown as SessaoCadastro;

const registro = (modelos: { id: number; codigo: string }[], rep: unknown) =>
  ({
    modelos: async () => modelos,
    representacao: async () => (rep ? { representacao: rep, selo: 's', versaoLayout: 1 } : null),
  }) as unknown as ServicoRegistro;

const DADOS = {
  paciente: 1,
  cabecalho: '9',
  reg: 9,
  cor: 'laranja' as const,
  conteudo: PROTOCOLO_SINTETICO,
  sinais: {
    pas: 1,
    pad: 1,
    fc: 1,
    fr: 1,
    temperatura: 36,
    saturacao: 99,
    glicemia: null,
    dor: 0,
    glasgow: 15,
  },
  queixa: 'Dor',
  observacoes: null,
  alergia: null,
  comorbidades: [],
  classificacao: {
    versaoProtocolo: 1,
    fluxograma: 'geral',
    discriminadores: [],
    automaticos: [],
    corProposta: 'laranja' as const,
    corFinal: 'laranja' as const,
    justificativa: null,
    motivo: 'inicial' as const,
    descricaoMudanca: null,
    anterior: null,
    tempoAlvoMin: 10,
    eventos: [{ evento: 'recepcao.classificacao.concluida', chave: '1:inicial:laranja' }],
  },
};

describe('formulário de classificação do prontuário (E08)', () => {
  it('desligado com o motivo enquanto o modelo está fora da liberação do registro clínico', async () => {
    const f = formularioDaSessao(sessao, {
      registro: registro([], null),
      configuracao: null,
      liberacaoRegistro: async () => ({ ligada: true, motivo: null }),
      porta: new PortaClassificacaoMemoria(),
    });
    const e = await f.estado();
    expect(e.ligado).toBe(false);
    expect(e.motivo).toMatch(/ainda não está liberado/);
    expect(e.motivo).toMatch(/fica só neste sistema/);
  });

  it('sem o modelo no estabelecimento: 404; modelo sem as perguntas esperadas: recusado sem gravar', async () => {
    const dep = (modelos: { id: number; codigo: string }[], rep: unknown) => ({
      registro: registro(modelos, rep),
      configuracao: null,
      liberacaoRegistro: async () => ({ ligada: true, motivo: null }),
      porta: new PortaClassificacaoMemoria(),
    });
    await expect(formularioDaSessao(sessao, dep([], null)).gravar(DADOS)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      formularioDaSessao(sessao, dep([{ id: 50, codigo: 'E08' }], { itens: [] })).gravar(DADOS),
    ).rejects.toMatchObject({ status: 409 });
  });
});
