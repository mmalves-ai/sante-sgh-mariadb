// Entradas da gestão da qualidade e dos envios regulatórios (M48, etapa 5).
import { describe, expect, it } from 'vitest';
import { PERMISSOES_QUALIDADE_GESTAO_M48 } from '../permissoes/qualidade-gestao.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  ESCALA_GUT,
  esquemaCodigoDocumento,
  esquemaGerarEnvioRegulatorio,
  esquemaPublicarDocumento,
  esquemaRegistrarManifestacao,
  esquemaRegistrarReuniaoComissao,
  esquemaRegistrarTransmissaoEnvio,
  rotuloTipoEnvioRegulatorio,
  TIPOS_COMISSAO,
} from './gestao.js';

const manifestacao = {
  canal: 'telefone',
  tipo: 'reclamacao',
  identificada: true,
  paciente: null,
  manifestante: 'Maria Sintética',
  contato: null,
  area: 'Recepção',
  relato: 'Demora no atendimento da recepção.',
  recebidaEm: '2026-10-27T09:00',
  pesquisa: null,
};

describe('entradas', () => {
  it('código do documento em maiúsculas, com ponto, hífen e barra', () => {
    expect(esquemaCodigoDocumento.parse(' pop-enf/001 ')).toBe('POP-ENF/001');
    expect(esquemaCodigoDocumento.safeParse('POP ENF').success).toBe(false);
  });
  it('publicação: elaborador em maiúsculas, conteúdo mínimo e data válida', () => {
    const d = esquemaPublicarDocumento.parse({
      codigo: 'POP-ENF-001',
      tipo: 'pop',
      titulo: 'Identificação do paciente',
      area: 'Enfermagem',
      conteudo: 'Conferir dois identificadores antes de todo procedimento.',
      resumoAlteracao: null,
      elaboradoPor: 'enf.ana',
      revisadoPor: null,
      vigenciaAte: '2028-10-27',
      exigeCiencia: true,
      substitui: null,
    });
    expect(d.elaboradoPor).toBe('ENF.ANA');
    expect(esquemaPublicarDocumento.safeParse({ ...d, vigenciaAte: '2028-02-30' }).success).toBe(false);
  });
  it('manifestação anônima não leva nome; a identificada leva paciente ou nome; a da pesquisa só pelo canal', () => {
    expect(esquemaRegistrarManifestacao.safeParse(manifestacao).success).toBe(true);
    expect(esquemaRegistrarManifestacao.safeParse({ ...manifestacao, identificada: false }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarManifestacao.safeParse({ ...manifestacao, identificada: false, manifestante: null })
        .success,
    ).toBe(true);
    expect(esquemaRegistrarManifestacao.safeParse({ ...manifestacao, manifestante: null }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarManifestacao.safeParse({ ...manifestacao, paciente: 5, manifestante: null }).success,
    ).toBe(true);
    expect(esquemaRegistrarManifestacao.safeParse({ ...manifestacao, pesquisa: 9 }).success).toBe(false);
    expect(
      esquemaRegistrarManifestacao.safeParse({ ...manifestacao, canal: 'pesquisa', pesquisa: 9 }).success,
    ).toBe(true);
  });
  it('reunião com presença por posição; envio pela competência; transmissão com o resumo', () => {
    expect(
      esquemaRegistrarReuniaoComissao.safeParse({
        comissao: 1,
        versaoComissao: 3,
        tipo: 'ordinaria',
        realizadaEm: '2026-10-20T14:00',
        pauta: 'Indicadores do mês',
        ata: 'Apresentados os indicadores; aprovada a revisão do protocolo.',
        presentes: [0, 1],
        convidados: null,
        deliberacoes: null,
      }).success,
    ).toBe(true);
    expect(esquemaGerarEnvioRegulatorio.safeParse({ tipo: 'iras', competencia: '2026-13' }).success).toBe(
      false,
    );
    expect(
      esquemaRegistrarTransmissaoEnvio.safeParse({
        envio: 1,
        versao: 1,
        transmitidoEm: '2026-10-21T10:00',
        protocolo: 'ABC123',
        hash: 'F'.repeat(64),
      }).success,
    ).toBe(false);
  });
});

describe('vocabulário e permissões', () => {
  it('a escala GUT tem cinco pontos por eixo e as comissões obrigatórias têm rótulo', () => {
    for (const eixo of Object.values(ESCALA_GUT)) expect(eixo).toHaveLength(5);
    expect(TIPOS_COMISSAO.map((t) => t.codigo)).toContain('ccih');
    expect(rotuloTipoEnvioRegulatorio('pmQualiss')).toMatch(/PM-QUALISS/);
  });
  it('as nove permissões no formato, só do novo, com o documento lido por todo perfil de pessoa', () => {
    expect(PERMISSOES_QUALIDADE_GESTAO_M48).toHaveLength(9);
    for (const p of PERMISSOES_QUALIDADE_GESTAO_M48) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado).toEqual([]);
    }
    expect(
      PERMISSOES_QUALIDADE_GESTAO_M48.find((p) => p.codigo === 'qualidade.documento.ler')?.concessaoPorPerfil,
    ).toBe('todos-os-perfis-de-pessoa');
  });
});
