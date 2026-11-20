// O que o portal mostra e como registra as escolhas do titular (M50 etapa 1, regras 1, 5 e 13). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  agruparAcessos,
  diaCivil,
  type DocumentoCandidato,
  documentoVisivelNoPortal,
  finalidadeEditavelNoPortal,
  idSignatario,
  idSituacaoTermo,
  janelaValida,
  signatarioDaSessao,
  situacaoInicialPedidoPortal,
} from './privacidade.js';

describe('documentos no portal', () => {
  const receita: DocumentoCandidato = {
    tipo: 'receita',
    nivelAssinatura: 'icp-brasil',
    eventos: ['emitido', 'assinado'],
    paciente: 7,
  };
  it('receita assinada ICP do próprio paciente aparece', () => {
    expect(documentoVisivelNoPortal(receita, 7, 'icp-brasil')).toBe(true);
  });
  it('outro paciente, tipo fora da lista, sem assinatura, nível abaixo, suspenso ou retificado: não aparece', () => {
    expect(documentoVisivelNoPortal(receita, 8, 'icp-brasil')).toBe(false);
    expect(documentoVisivelNoPortal({ ...receita, tipo: 'registro-clinico' }, 7, 'icp-brasil')).toBe(false);
    expect(documentoVisivelNoPortal({ ...receita, eventos: ['emitido'] }, 7, 'icp-brasil')).toBe(false);
    expect(
      documentoVisivelNoPortal({ ...receita, nivelAssinatura: 'eletronica-avancada' }, 7, 'icp-brasil'),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal({ ...receita, nivelAssinatura: 'desconhecido' }, 7, 'eletronica-avancada'),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal({ ...receita, eventos: [...receita.eventos, 'suspenso'] }, 7, 'icp-brasil'),
    ).toBe(false);
    expect(
      documentoVisivelNoPortal({ ...receita, eventos: [...receita.eventos, 'retificado'] }, 7, 'icp-brasil'),
    ).toBe(false);
  });
  it('com o mínimo em assinatura avançada, a avançada aparece', () => {
    expect(
      documentoVisivelNoPortal(
        { ...receita, nivelAssinatura: 'eletronica-avancada' },
        7,
        'eletronica-avancada',
      ),
    ).toBe(true);
  });
});

describe('consentimentos', () => {
  const dominioRepre = [
    { id: 1, descricao: 'Paciente', ativo: true },
    { id: 2, descricao: 'Representante Legal', ativo: true },
  ];
  const dominioSituacao = [
    { id: 1, descricao: 'Lançado', ativo: true },
    { id: 3, descricao: 'Consentimento Autorizado', ativo: true },
    { id: 4, descricao: 'Não autorizado', ativo: true },
  ];
  it('atendimento não se muda pelo portal', () => {
    expect(finalidadeEditavelNoPortal('atendimento')).toBe(false);
    expect(finalidadeEditavelNoPortal('pesquisa')).toBe(true);
  });
  it('signatário pela escolha da sessão e o ID pelo domínio lido ao vivo', () => {
    expect(signatarioDaSessao(null)).toBe('paciente');
    expect(signatarioDaSessao('9')).toBe('representante-legal');
    expect(idSignatario('paciente', dominioRepre)).toBe(1);
    expect(idSignatario('representante-legal', dominioRepre)).toBe(2);
    expect(idSignatario('paciente', [{ id: 1, descricao: 'Paciente', ativo: false }])).toBeNull();
  });
  it('situação do termo pela descrição (com ou sem acento)', () => {
    expect(idSituacaoTermo(true, dominioSituacao)).toBe(3);
    expect(idSituacaoTermo(false, dominioSituacao)).toBe(4);
    expect(idSituacaoTermo(false, [{ id: 9, descricao: 'NAO AUTORIZADO', ativo: true }])).toBe(9);
    expect(
      idSituacaoTermo(true, [{ id: 3, descricao: 'Consentimento Autorizado', ativo: false }]),
    ).toBeNull();
  });
});

describe('pedidos do titular', () => {
  it('conta ativa com segundo fator: identidade verificada; senão, aberto', () => {
    expect(situacaoInicialPedidoPortal({ ativa: true, segundoFatorConfirmado: true })).toBe(
      'identidade-verificada',
    );
    expect(situacaoInicialPedidoPortal({ ativa: true, segundoFatorConfirmado: false })).toBe('aberto');
    expect(situacaoInicialPedidoPortal({ ativa: false, segundoFatorConfirmado: true })).toBe('aberto');
  });
});

describe('relatório de acessos', () => {
  it('dia civil de São Paulo', () => {
    expect(diaCivil('2026-10-24T02:00:00.000Z')).toBe('2026-10-23');
    expect(diaCivil('2026-10-24T03:00:00.000Z')).toBe('2026-10-24');
  });
  it('agrupa por dia, pessoa e natureza; ignora eventos fora do mapa; mais recente primeiro', () => {
    const r = agruparAcessos([
      { em: '2026-10-24T13:00:00.000Z', usuario: 'ENF.A', evento: 'pep.prontuario.lido' },
      { em: '2026-10-24T12:00:00.000Z', usuario: 'ENF.A', evento: 'pep.registro.lido' },
      { em: '2026-10-24T14:00:00.000Z', usuario: 'ENF.A', evento: 'pep.prontuario.lido' },
      { em: '2026-10-24T12:30:00.000Z', usuario: 'MED.B', evento: 'acesso.emergencia.aberta' },
      { em: '2026-10-24T12:40:00.000Z', usuario: 'AUD.C', evento: 'auditoria.leitura.alertada' },
      { em: '2026-10-23T12:40:00.000Z', usuario: 'MED.B', evento: 'pep.prontuario.buscado' },
    ]);
    expect(r).toEqual([
      {
        dia: '2026-10-24',
        natureza: 'consulta-ao-prontuario',
        usuario: 'ENF.A',
        vezes: 3,
        primeiraEm: '2026-10-24T12:00:00.000Z',
        ultimaEm: '2026-10-24T14:00:00.000Z',
      },
      {
        dia: '2026-10-24',
        natureza: 'acesso-de-emergencia',
        usuario: 'MED.B',
        vezes: 1,
        primeiraEm: '2026-10-24T12:30:00.000Z',
        ultimaEm: '2026-10-24T12:30:00.000Z',
      },
      {
        dia: '2026-10-23',
        natureza: 'busca',
        usuario: 'MED.B',
        vezes: 1,
        primeiraEm: '2026-10-23T12:40:00.000Z',
        ultimaEm: '2026-10-23T12:40:00.000Z',
      },
    ]);
  });
  it('empate na hora: ordena pela pessoa', () => {
    const r = agruparAcessos([
      { em: '2026-10-24T13:00:00.000Z', usuario: 'Z', evento: 'pep.prontuario.lido' },
      { em: '2026-10-24T13:00:00.000Z', usuario: 'A', evento: 'pep.prontuario.lido' },
    ]);
    expect(r.map((x) => x.usuario)).toEqual(['A', 'Z']);
  });
  it('janela do relatório', () => {
    expect(janelaValida('2026-01-01', '2026-12-31', 366)).toBe(true);
    expect(janelaValida('2025-01-01', '2026-01-02', 366)).toBe(false);
    expect(janelaValida('2026-02-01', '2026-01-01', 366)).toBe(false);
    expect(janelaValida('x', '2026-01-01', 366)).toBe(false);
  });
});
