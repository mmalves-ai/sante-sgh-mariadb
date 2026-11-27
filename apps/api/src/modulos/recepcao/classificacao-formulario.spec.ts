// M44 (ficha, seção 5; regra 7): o formulário de classificação do prontuário (E08) pela classificação de risco. O
// modelo fora da liberação do cliente (parâmetro pep.evolucao.modelosForaDaLiberacao, ADR 0002) ou fora da lista de
// liberados: a tela avisa e a classificação fica só neste sistema (POL-3). A gravação, quando ligada, monta as respostas pelo motor e chama o registro clínico com a
// classificação na mesma transação (a composição é provada pelas assinaturas e08-* na cópia). Fakes sintéticos.
import { describe, expect, it } from 'vitest';
import { formularioDaSessao } from './classificacao-formulario.js';
import { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { FonteConfiguracao } from '../config/configuracao-fonte.js';
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
  const valor = (chave: string, v: string) => ({
    id: chave,
    chave,
    nivel: 'estabelecimento',
    alvo: 'aa',
    valor: v,
    vigenteDesde: '2026-01-01T00:00:00.000Z',
    vigenteAte: null,
    justificativa: 'teste',
    autor: 'SINT.ADMIN',
  });
  const configuracao = (...vs: ReturnType<typeof valor>[]) =>
    ({ valoresParametro: async () => vs }) as unknown as FonteConfiguracao;

  it('sem configuração do cliente: nenhum modelo especial; fora da lista de liberados, desligado com o motivo', async () => {
    const f = formularioDaSessao(sessao, {
      registro: registro([], null),
      configuracao: null,
      liberacaoRegistro: async () => ({ ligada: true, motivo: null }),
      porta: new PortaClassificacaoMemoria(),
    });
    const e = await f.estado();
    expect(e.ligado).toBe(false);
    expect(e.motivo).toMatch(/não está entre os modelos liberados/);
  });

  it('desligado com o motivo do cliente quando o modelo está fora da liberação, mesmo listado', async () => {
    const f = formularioDaSessao(sessao, {
      registro: registro([], null),
      configuracao: configuracao(
        valor('pep.evolucao.modelosLiberados', 'E08'),
        valor('pep.evolucao.modelosForaDaLiberacao', 'e08: Conferência do formulário abaixo da meta.'),
      ),
      liberacaoRegistro: async () => ({ ligada: true, motivo: null }),
      porta: new PortaClassificacaoMemoria(),
    });
    const e = await f.estado();
    expect(e.ligado).toBe(false);
    expect(e.motivo).toMatch(/ainda não está liberado/);
    expect(e.motivo).toMatch(/conferência do formulário abaixo da meta/);
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
