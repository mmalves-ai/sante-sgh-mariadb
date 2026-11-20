import type { MatrizPentest, RegistroConferencia } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  cenariosParaConferir,
  type EntradaConferencia,
  estadoEfetivo,
  type OperacaoHomologacao,
  roteiroHomologacaoMarkdown,
  situacaoPentest,
  verificarConferencias,
} from './homologacao.js';

const HOMOLOGADA = 'a1b2c3d4e5f60718';

const op = (o: Partial<OperacaoHomologacao> = {}): OperacaoHomologacao => ({
  nome: 'agenda.agendarConsulta',
  modulo: 'agenda',
  estado: { pc: 'conferida' },
  cenarios_assinatura: ['basico', 'recusa-horario'],
  origem_especificacao: 'sante-api',
  conferencias: [
    {
      estabelecimento: 'pc',
      evidencia: 'docs/operacoes/conferencias/pc/agenda.agendarConsulta.yaml',
    },
  ],
  triggers: [],
  ...o,
});

const reg = (r: Partial<RegistroConferencia> = {}): RegistroConferencia => ({
  formato: 1,
  operacao: 'agenda.agendarConsulta',
  estabelecimento: 'pc',
  data: '2026-11-03',
  conferentes: [{ papel: 'chave-usuario', area: 'agendamento' }],
  versao_roteiro: '2026-10-23.1',
  impressao_schema: HOMOLOGADA,
  cenarios: [
    { cenario: 'basico', resultado: 'conforme' },
    { cenario: 'recusa-horario', resultado: 'conforme' },
  ],
  resultado: 'conferida',
  revisao: { pr: '#1', data: '2026-11-03' },
  ...r,
});

function entrada(
  ops: OperacaoHomologacao[],
  registros: [string, RegistroConferencia | { erro: string }][],
  o: Partial<EntradaConferencia> = {},
): EntradaConferencia {
  return {
    operacoes: ops,
    registros: new Map(registros),
    ultimoResultado: () => ({ basico: 'verde', 'recusa-horario': 'verde' }),
    origemDoCenario: () => 'cenario-controlado',
    impressaoHomologada: () => HOMOLOGADA,
    reproducao: () => ({ impressaoSchema: HOMOLOGADA, executadoEm: '2026-11-03T10:00:00Z' }),
    pentest: { bloqueiaLiberacao: true, motivo: 'pentest externo não concluído' },
    ...o,
  };
}

describe('conferencia:verificar (regra 4)', () => {
  it('registro completo, cenários verdes, referência do legado e schema homologado: 0 problema', () => {
    const s = verificarConferencias(entrada([op()], [['pc/agenda.agendarConsulta', reg()]]));
    expect(s.problemas).toEqual([]);
  });
  it('conferida sem registro: recusa', () => {
    const s = verificarConferencias(entrada([op()], []));
    expect(s.problemas).toEqual(['pc/agenda.agendarConsulta: conferida sem registro de conferência']);
  });
  it('cenário não verde na última reprodução: recusa', () => {
    const s = verificarConferencias(
      entrada([op()], [['pc/agenda.agendarConsulta', reg()]], {
        ultimoResultado: () => ({ basico: 'diferencas', 'recusa-horario': 'verde' }),
      }),
    );
    expect(s.problemas.join()).toMatch(/basico não está verde/);
  });
  it('schema diferente do homologado: recusa', () => {
    const s = verificarConferencias(
      entrada([op()], [['pc/agenda.agendarConsulta', reg({ impressao_schema: 'ffffffffffffffff' })]]),
    );
    expect(s.problemas.join()).toMatch(/impressão do schema diferente/);
  });
  it('cenário do catálogo não conferido, divergente na tela ou referência da reprodução: recusa', () => {
    const s = verificarConferencias(
      entrada(
        [op()],
        [['pc/agenda.agendarConsulta', reg({ cenarios: [{ cenario: 'basico', resultado: 'divergente' }] })]],
        { origemDoCenario: () => 'reproducao' },
      ),
    );
    const t = s.problemas.join('\n');
    expect(t).toMatch(/recusa-horario do catálogo não conferido/);
    expect(t).toMatch(/basico divergente/);
    expect(t).toMatch(/não é uma captura de referência/);
  });
  it('já gravada pela integração atual (sante-api) com referência de perfil: recusa (DP-8), não só aviso', () => {
    const s = verificarConferencias(
      entrada([op()], [['pc/agenda.agendarConsulta', reg()]], { origemDoCenario: () => 'perfil' }),
    );
    expect(s.problemas.join('\n')).toMatch(
      /basico: referência de perfil; esta operação exige o cenário controlado \(já gravada/,
    );
  });
  it('ondas 0 e 1 exigem o cenário controlado; da onda 2 em diante, perfil é aviso', () => {
    const onda1 = op({ nome: 'agenda.remarcarConsulta', origem_especificacao: 'perfil-passivo' });
    const r1 = reg({ operacao: 'agenda.remarcarConsulta' });
    const s1 = verificarConferencias(
      entrada([onda1], [['pc/agenda.remarcarConsulta', r1]], { origemDoCenario: () => 'perfil' }),
    );
    expect(s1.problemas.join('\n')).toMatch(/ondas 0 e 1/);
    const onda2 = op({
      nome: 'cirurgia.agendarCirurgia',
      modulo: 'cirurgia',
      origem_especificacao: 'perfil-passivo',
      conferencias: [],
    });
    const r2 = reg({ operacao: 'cirurgia.agendarCirurgia' });
    const s2 = verificarConferencias(
      entrada([onda2], [['pc/cirurgia.agendarCirurgia', r2]], { origemDoCenario: () => 'perfil' }),
    );
    expect(s2.problemas).toEqual([]);
    expect(s2.avisos.join('\n')).toMatch(/referência de perfil/);
  });
  it('regra 4: reprodução sem a impressão, sobre impressão diferente da do registro ou da homologada: recusa', () => {
    const com = (impressaoSchema: string | null, homologada = HOMOLOGADA) =>
      verificarConferencias(
        entrada([op()], [['pc/agenda.agendarConsulta', reg()]], {
          reproducao: () => ({ impressaoSchema, executadoEm: '2026-10-01T10:00:00Z' }),
          impressaoHomologada: () => homologada,
        }),
      ).problemas.join('\n');
    expect(com(null)).toMatch(/não registra a impressão do schema/);
    expect(com('ffffffffffffffff')).toMatch(/diferente da do registro/);
    expect(com(HOMOLOGADA)).toBe('');
  });
  it('regra 8: liberada com o pentest bloqueando (ou matriz ilegível): recusa; pentest concluído: segue', () => {
    const lib = op({ estado: { pc: 'liberada' } });
    const r = [['pc/agenda.agendarConsulta', reg()]] as [string, RegistroConferencia][];
    expect(verificarConferencias(entrada([lib], r)).problemas.join()).toMatch(
      /liberada com o pentest bloqueando a liberação \(pentest externo não concluído\)/,
    );
    expect(verificarConferencias(entrada([lib], r, { pentest: null })).problemas.join()).toMatch(
      /matriz de achados ilegível/,
    );
    expect(
      verificarConferencias(entrada([lib], r, { pentest: { bloqueiaLiberacao: false, motivo: 'ok' } }))
        .problemas,
    ).toEqual([]);
  });
  it('relatório da última reprodução ilegível: recusa', () => {
    const s = verificarConferencias(
      entrada([op()], [['pc/agenda.agendarConsulta', reg()]], {
        ultimoResultado: () => ({ '(resultado ilegível)': 'ilegivel' }),
      }),
    );
    expect(s.problemas.join()).toMatch(/relatório da última reprodução ilegível/);
  });
  it('registro clínico exige médico e enfermeiro', () => {
    const pep = op({
      nome: 'pep.registrarEvolucao',
      modulo: 'pep',
      cenarios_assinatura: ['basico'],
      conferencias: [],
    });
    const r = reg({
      operacao: 'pep.registrarEvolucao',
      cenarios: [{ cenario: 'basico', resultado: 'conforme' }],
      conferentes: [{ papel: 'medico', area: 'clínica' }],
    });
    expect(
      verificarConferencias(
        entrada([pep], [['pc/pep.registrarEvolucao', r]], { ultimoResultado: () => ({ basico: 'verde' }) }),
      ).problemas.join(),
    ).toMatch(/médico e do enfermeiro/);
    const r2 = { ...r, conferentes: [...r.conferentes, { papel: 'enfermeiro' as const, area: 'UTI' }] };
    expect(
      verificarConferencias(
        entrada([pep], [['pc/pep.registrarEvolucao', r2]], { ultimoResultado: () => ({ basico: 'verde' }) }),
      ).problemas,
    ).toEqual([]);
  });
  it('registro de operação ainda não conferida: só aviso; registro inválido e fora do catálogo: problema ou aviso', () => {
    const verde = op({ estado: { pc: 'verde' } });
    const s = verificarConferencias(
      entrada(
        [verde],
        [
          ['pc/agenda.agendarConsulta', reg()],
          ['pc/agenda.inexistente', reg({ operacao: 'agenda.inexistente' })],
          ['pc/agenda.quebrado', { erro: 'formato' }],
        ],
      ),
    );
    expect(s.problemas).toEqual(['pc/agenda.quebrado: registro inválido (formato)']);
    expect(s.avisos.join('\n')).toMatch(/ainda não marca a operação como conferida/);
    expect(s.avisos.join('\n')).toMatch(/fora do catálogo/);
  });
});

describe('estado efetivo depois da reexecução (regra 6)', () => {
  it('conferida com divergência volta a bloqueada; liberada também, com recolhimento imediato', () => {
    expect(estadoEfetivo('conferida', { basico: 'diferencas' })).toMatchObject({
      estado: 'bloqueada',
      recolher: false,
    });
    expect(estadoEfetivo('liberada', { basico: 'diferencas' })).toMatchObject({
      estado: 'bloqueada',
      recolher: true,
    });
    expect(estadoEfetivo('verde', { basico: 'diferencas' }).estado).toBe('verde');
    expect(estadoEfetivo('conferida', { basico: 'verde' }).estado).toBe('conferida');
    expect(estadoEfetivo('conferida', null).estado).toBe('conferida');
    expect(estadoEfetivo('liberada', { '(resultado ilegível)': 'ilegivel' })).toMatchObject({
      estado: 'bloqueada',
      recolher: true,
    });
  });
});

describe('pentest (regra 8)', () => {
  const base: MatrizPentest = {
    formato: 1,
    situacao: 'concluido',
    versao_candidata: 'rc1',
    ambiente: 'homologação',
    lista: 'OWASP ASVS 4.0.3 nível 2',
    data_relatorio: '2026-11-10',
    data_reteste: null,
    achados: [],
  };
  it('sem pentest concluído: bloqueia', () => {
    expect(
      situacaoPentest({ ...base, situacao: 'nao-iniciado', data_relatorio: null }).bloqueiaLiberacao,
    ).toBe(true);
  });
  it('alto aberto bloqueia; corrigido sem reteste bloqueia; retestado corrigido ou exceção libera', () => {
    const a = {
      id: 'PT-001',
      titulo: 'Troca de ID',
      asvs: 'V4.2.1',
      componente: 'api' as const,
      severidade: 'alta' as const,
    };
    expect(situacaoPentest({ ...base, achados: [{ ...a, situacao: 'aberto' }] }).abertosCriticosOuAltos).toBe(
      1,
    );
    expect(
      situacaoPentest({ ...base, achados: [{ ...a, situacao: 'corrigido', correcao: 'abc1234' }] })
        .bloqueiaLiberacao,
    ).toBe(true);
    expect(
      situacaoPentest({
        ...base,
        situacao: 'retestado',
        data_reteste: '2026-11-12',
        achados: [
          {
            ...a,
            situacao: 'retestado',
            correcao: 'abc1234',
            reteste: { data: '2026-11-12', resultado: 'corrigido' },
          },
        ],
      }).bloqueiaLiberacao,
    ).toBe(false);
    expect(situacaoPentest(base).bloqueiaLiberacao).toBe(false);
  });
});

describe('roteiro de homologação', () => {
  it('ondas em ordem, a da integração atual primeiro, colisão e recusa em todas e sem citar o outro sistema pelo nome', () => {
    const md = roteiroHomologacaoMarkdown({
      hospital: 'pc',
      versao: '2026-10-23.1',
      bloqueio: null,
      operacoes: [
        {
          nome: 'pep.prescrever',
          estado: 'verde',
          cenarios: ['basico'],
          santeApi: false,
          origens: ['perfil'],
          motivo: '',
          escrita: true,
        },
        {
          nome: 'agenda.remarcarConsulta',
          estado: 'verde',
          cenarios: ['basico'],
          santeApi: false,
          origens: ['perfil'],
          motivo: '',
          escrita: true,
        },
        {
          nome: 'agenda.agendarConsulta',
          estado: 'verde',
          cenarios: ['basico'],
          santeApi: true,
          origens: ['perfil'],
          motivo: '',
          escrita: true,
          tabelas: ['SIPACAGD (INSERT)'],
          descricao: 'Marca a consulta, como o SPDATA, com o padrão do legado',
        },
        {
          nome: 'acesso.trocarSenha',
          estado: 'verde',
          cenarios: ['basico'],
          santeApi: false,
          origens: ['perfil'],
          motivo: '',
          escrita: true,
        },
      ],
      fila: [{ operacao: 'enfermagem.aprazarHorario', motivo: 'cenário controlado no M36' }],
    });
    const i0 = md.indexOf('## Onda 0');
    const i1 = md.indexOf('## Onda 1');
    const i2 = md.indexOf('## Onda 2');
    expect(i0).toBeGreaterThan(0);
    expect(i1).toBeGreaterThan(i0);
    expect(i2).toBeGreaterThan(i1);
    expect(md.indexOf('agenda.agendarConsulta')).toBeLessThan(md.indexOf('agenda.remarcarConsulta'));
    expect(md).toMatch(/basico, colisao, recusa/);
    // o que deve aparecer e onde abrir, por operação, com o link para a tabela do setor
    expect(md).toMatch(
      /\| `agenda.agendarConsulta` \| verde \| basico, colisao, recusa \| Marca a consulta, como o outro sistema, com o padrão do outro sistema \| \[[^\]]+\]\(#[^)]+\); SIPACAGD \(INSERT\) \|/,
    );
    expect(md).toMatch(/enfermagem\.aprazarHorario/);
    expect(md).not.toMatch(/SPDATA/i);
    expect(md).not.toMatch(/\blegado\b/i);
    // nenhuma linha de operação pede o mesmo cenário duas vezes
    for (const l of md.split('\n').filter((x) => /^\| \d+ \| `/.test(x))) {
      const cen = (l.split(' | ')[3] ?? '').split(', ');
      expect(new Set(cen).size).toBe(cen.length);
    }
  });
});

describe('cenários a conferir', () => {
  it('sem repetir colisão nem recusa já do catálogo; colisão só nas que gravam', () => {
    expect(cenariosParaConferir({ cenarios: ['primeira', 'recusa', 'colisao'], escrita: true })).toEqual([
      'primeira',
      'recusa',
      'colisao',
    ]);
    expect(cenariosParaConferir({ cenarios: ['basico'], escrita: false })).toEqual(['basico', 'recusa']);
  });
});
