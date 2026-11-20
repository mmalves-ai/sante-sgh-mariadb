// Entradas da notificação de incidentes (M48, etapa 1): o que o botão global, a triagem e o Notivisa aceitam e recusam.
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO, PERFIS_COMPLEMENTARES } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { PERFIL_NSP, PERMISSOES_QUALIDADE, PERMISSOES_QUALIDADE_M48 } from '../permissoes/qualidade.js';
import { CATALOGO_EVENTOS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import {
  CLASSIFICACOES_OMS,
  esquemaAcompanharNotificacao,
  esquemaDescartarNotificacao,
  esquemaDevolverAoNotificador,
  esquemaDistribuirNotificacao,
  esquemaFiltroNotificacoes,
  esquemaNotificarIncidente,
  esquemaRegistrarTranscricaoNotivisa,
  esquemaTriarNotificacao,
  FORMATO_CODIGO_ACOMPANHAMENTO,
  GRAUS_DANO,
  ordemDoDano,
  rotuloClassificacaoOms,
  rotuloGrauDano,
  rotuloTipoIncidente,
  TIPOS_INCIDENTE,
  type NotificarIncidenteEntrada,
} from './notificacao.js';

const base: NotificarIncidenteEntrada = {
  atendimento: 500,
  unidade: null,
  local: null,
  ocorridoEm: '2026-10-18T03:40:00',
  tipo: 'queda',
  tipoOutro: null,
  chegouAoPaciente: true,
  danoPercebido: 'leve',
  descricao: 'Paciente sintético encontrado no chão ao lado do leito, grade abaixada.',
  anonima: false,
  origem: { tela: '/pep/prontuario/7' },
};

describe('vocabulário', () => {
  it('os dez tipos (a flebite do W0-04), as quatro classificações da OMS e os cinco graus de dano em ordem, com rótulo de produto', () => {
    expect(TIPOS_INCIDENTE.map((t) => t.codigo)).toEqual([
      'medicacao',
      'queda',
      'lesaoPressao',
      'identificacao',
      'cirurgia',
      'infeccao',
      'transfusao',
      'dispositivo',
      'flebite',
      'outro',
    ]);
    expect(CLASSIFICACOES_OMS.filter((c) => c.atingiu).map((c) => c.codigo)).toEqual([
      'incidenteSemDano',
      'eventoAdverso',
    ]);
    expect(GRAUS_DANO.map((g) => g.ordem)).toEqual([0, 1, 2, 3, 4]);
    expect(rotuloTipoIncidente('lesaoPressao')).toBe('Lesão por pressão');
    expect(rotuloClassificacaoOms('quaseErro')).toBe('Quase erro');
    expect(rotuloGrauDano('obito')).toBe('Óbito');
    expect(ordemDoDano('grave')).toBe(3);
  });
});

describe('notificarIncidente', () => {
  it('aceita a notificação com atendimento (o servidor relê o contexto) e a anônima sem atendimento com a unidade', () => {
    expect(esquemaNotificarIncidente.safeParse(base).success).toBe(true);
    expect(
      esquemaNotificarIncidente.safeParse({
        ...base,
        atendimento: null,
        unidade: 1,
        local: '2º andar, corredor',
        anonima: true,
        ocorridoEm: '2026-10-18T03:40',
      }).success,
    ).toBe(true);
  });

  it('recusa sem atendimento e sem unidade, "outro" sem descrever o tipo e dano quando não chegou ao paciente', () => {
    const r1 = esquemaNotificarIncidente.safeParse({ ...base, atendimento: null });
    expect(r1.success).toBe(false);
    expect(r1.error?.issues[0]?.path).toEqual(['unidade']);
    const r2 = esquemaNotificarIncidente.safeParse({ ...base, tipo: 'outro', tipoOutro: ' ' });
    expect(r2.error?.issues[0]?.path).toEqual(['tipoOutro']);
    const r3 = esquemaNotificarIncidente.safeParse({ ...base, chegouAoPaciente: false });
    expect(r3.error?.issues[0]?.path).toEqual(['danoPercebido']);
    expect(
      esquemaNotificarIncidente.safeParse({ ...base, chegouAoPaciente: false, danoPercebido: 'nenhum' })
        .success,
    ).toBe(true);
  });

  it('recusa descrição curta, instante com fuso e tela fora do formato de rota', () => {
    expect(esquemaNotificarIncidente.safeParse({ ...base, descricao: 'curta' }).success).toBe(false);
    expect(esquemaNotificarIncidente.safeParse({ ...base, ocorridoEm: '2026-10-18T03:40:00Z' }).success).toBe(
      false,
    );
    expect(esquemaNotificarIncidente.safeParse({ ...base, ocorridoEm: '2026-02-30T10:00' }).success).toBe(
      false,
    );
    expect(
      esquemaNotificarIncidente.safeParse({ ...base, origem: { tela: 'javascript:alert(1)' } }).success,
    ).toBe(false);
    expect(
      esquemaNotificarIncidente.safeParse({ ...base, origem: { tela: '/x', sugestao: 'queda:12' } }).success,
    ).toBe(true);
    expect(
      esquemaNotificarIncidente.safeParse({ ...base, origem: { tela: '/x', sugestao: 'Queda 12' } }).success,
    ).toBe(false);
  });

  it('recusa caractere fora do CP1252 na descrição (o banco é CP1252)', () => {
    expect(
      esquemaNotificarIncidente.safeParse({ ...base, descricao: 'Queda do leito 😀 sem dano' }).success,
    ).toBe(false);
  });
});

describe('triagem, distribuição, devolutiva, descarte e Notivisa', () => {
  it('triagem com e sem "outro"', () => {
    const t = {
      notificacao: 1,
      versao: 1,
      tipo: 'queda',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'leve',
      neverEvent: false,
      justificativa: null,
    };
    expect(esquemaTriarNotificacao.safeParse(t).success).toBe(true);
    expect(esquemaTriarNotificacao.safeParse({ ...t, tipo: 'outro' }).success).toBe(false);
  });

  it('distribuição exige login, unidade e a data do prazo; devolutiva exige texto', () => {
    const d = {
      notificacao: 1,
      versao: 2,
      gestor: 'SGH.SINT.GESTOR',
      unidade: 1,
      prazoAnalise: '2026-11-10',
      orientacao: null,
    };
    expect(esquemaDistribuirNotificacao.safeParse(d).success).toBe(true);
    expect(esquemaDistribuirNotificacao.safeParse({ ...d, gestor: "X'; DROP" }).success).toBe(false);
    expect(esquemaDistribuirNotificacao.safeParse({ ...d, prazoAnalise: '2026-02-30' }).success).toBe(false);
    expect(esquemaDevolverAoNotificador.safeParse({ notificacao: 1, versao: 3, texto: 'ok' }).success).toBe(
      false,
    );
  });

  it('descarte com motivo e justificativa; transcrição com o número devolvido pelo portal', () => {
    expect(
      esquemaDescartarNotificacao.safeParse({
        notificacao: 1,
        versao: 1,
        motivo: 'duplicada',
        justificativa: 'Mesmo incidente notificado duas vezes.',
        duplicadaDe: 'NSP-2026-000001',
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarTranscricaoNotivisa.safeParse({
        notificacao: 1,
        versao: 4,
        numeroNotivisa: '2026.10.000123',
        transcritaEm: '2026-10-20T10:00:00',
      }).success,
    ).toBe(true);
    expect(
      esquemaRegistrarTranscricaoNotivisa.safeParse({
        notificacao: 1,
        versao: 4,
        numeroNotivisa: '<b>',
        transcritaEm: '2026-10-20T10:00:00',
      }).success,
    ).toBe(false);
  });

  it('acompanhamento normaliza para maiúsculas e recusa letras ambíguas no código', () => {
    const r = esquemaAcompanharNotificacao.parse({ protocolo: 'nsp-2026-000123', codigo: 'abcdefghjk' });
    expect(r).toEqual({ protocolo: 'NSP-2026-000123', codigo: 'ABCDEFGHJK' });
    expect(FORMATO_CODIGO_ACOMPANHAMENTO.test('ABCDEFGHI0')).toBe(false);
  });

  it('filtro da lista com página padrão', () => {
    expect(esquemaFiltroNotificacoes.parse({ prazo: 'vencido' })).toEqual({ prazo: 'vencido', pagina: 1 });
  });
});

describe('permissões, eventos e chave de liberação', () => {
  it('as seis permissões estão no catálogo, no formato, com fonte de concessão e o perfil do NSP', () => {
    const codigos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    for (const c of Object.values(PERMISSOES_QUALIDADE)) {
      expect(codigos.has(c)).toBe(true);
      expect(FORMATO_CODIGO_PERMISSAO.test(c)).toBe(true);
    }
    expect((PERFIS_COMPLEMENTARES as readonly string[]).includes(PERFIL_NSP)).toBe(true);
    const criar = PERMISSOES_QUALIDADE_M48.find((p) => p.codigo === PERMISSOES_QUALIDADE.notificacaoCriar);
    expect(criar?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
    // W0-04: a competência da CCIH (fechar e reabrir) mora no arquivo do módulo, mas é do perfil da CCIH.
    const daCcih = new Set<string>([
      PERMISSOES_QUALIDADE.competenciaFechar,
      PERMISSOES_QUALIDADE.competenciaReabrir,
      // Revisão do W0-04: corrigir o registro de outro autor (com a senha) é só da CCIH, e é crítica.
      PERMISSOES_QUALIDADE.ccihCorrigirDeOutro,
    ]);
    expect(
      PERMISSOES_QUALIDADE_M48.find((p) => p.codigo === PERMISSOES_QUALIDADE.ccihCorrigirDeOutro)
        ?.criticidade,
    ).toBe('critica');
    // W0-04 (M1): a aba de dispositivos do prontuário é da enfermagem, pelas opções da monitorização do legado.
    const daEnfermagem = new Set<string>([
      PERMISSOES_QUALIDADE.dispositivoInvasivoLer,
      PERMISSOES_QUALIDADE.dispositivoInvasivoRegistrar,
    ]);
    for (const p of PERMISSOES_QUALIDADE_M48.filter((x) => daEnfermagem.has(x.codigo))) {
      expect(p.categoria).toBe('clinica');
      expect(p.opcoesLegado.length).toBeGreaterThan(0);
    }
    // W0-04 (M5): a comissão de revisão de prontuários é do escritório da qualidade com a direção clínica; a resposta à
    // própria pendência, de todo profissional; o aval, do SAME (opções do controle de prontuários).
    const daRevisao = new Set<string>([
      PERMISSOES_QUALIDADE.revisaoProntuarioLer,
      PERMISSOES_QUALIDADE.revisaoProntuarioRegistrar,
    ]);
    for (const p of PERMISSOES_QUALIDADE_M48.filter((x) => daRevisao.has(x.codigo)))
      expect(p.perfis).toEqual(['gestao-qualidade', 'coordenador-medico']);
    const responder = PERMISSOES_QUALIDADE_M48.find(
      (p) => p.codigo === PERMISSOES_QUALIDADE.revisaoPendenciaResponder,
    );
    expect(responder?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
    const aval = PERMISSOES_QUALIDADE_M48.find((p) => p.codigo === PERMISSOES_QUALIDADE.revisaoAvalLer);
    expect(aval?.opcoesLegado).toEqual([2361, 2367]);
    const outras = new Set<string>([responder?.codigo ?? '', aval?.codigo ?? '', ...daRevisao]);
    for (const p of PERMISSOES_QUALIDADE_M48.filter(
      (x) => x !== criar && !daEnfermagem.has(x.codigo) && !outras.has(x.codigo),
    )) {
      expect(p.categoria).toBe('clinica');
      expect(p.perfis).toContain(daCcih.has(p.codigo) ? 'controle-infeccao' : PERFIL_NSP);
    }
  });

  it('os eventos da regra 11 (etapa 1) e a chave qualidade.notificacao', () => {
    const eventos = new Set(CATALOGO_EVENTOS.map((e) => e.codigo));
    for (const e of [
      'qualidade.incidente.notificado',
      'qualidade.notificacao.triada',
      'qualidade.notificacao.distribuida',
      'qualidade.notificacao.devolvida',
      'qualidade.notivisa.exportada',
      'qualidade.notivisa.transcrita',
      'qualidade.notificacao.lida',
    ])
      expect(eventos.has(e)).toBe(true);
    expect(RECURSOS_DESLIGADOS.find((r) => r.chave === 'qualidade.notificacao')?.marco).toBe('M48');
  });
});
