// Regras de tela da notificação de incidentes (M48, etapa 1): a entrada do diálogo pelo contrato (com o paciente da
// tela vai só o ID do atendimento; sem ele, a unidade), a tela de origem sem query, o tempo até o prazo, as ações por
// situação e os campos do Notivisa para copiar (o paciente só com iniciais, sexo e idade). Dados sintéticos.
import type { CamposNotivisa } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mensagensQualidade } from './i18n.js';
import {
  acoesDaSituacao,
  classeDoPrazo,
  dataHora,
  diasDepois,
  duracaoCurta,
  type FormularioIncidente,
  instanteDosCampos,
  linhasDosCampos,
  montarNotificacao,
  telaDeOrigem,
  textoParaCopiar,
} from './regras-qualidade.js';

const form = (x: Partial<FormularioIncidente> = {}): FormularioIncidente => ({
  semPaciente: false,
  unidade: null,
  local: '',
  data: '2026-10-22',
  hora: '08:30',
  tipo: 'queda',
  tipoOutro: '',
  chegouAoPaciente: 'sim',
  danoPercebido: 'leve',
  descricao: 'Paciente sintético escorregou ao sair do leito.',
  anonima: false,
  ...x,
});

describe('a entrada do diálogo "Notificar incidente"', () => {
  it('com o paciente da tela vai só o ID do atendimento (sem nome) e a tela de origem sem query', () => {
    const m = montarNotificacao(form(), { atendimento: 48001 }, '/pep/48001/prontuario?aba=alergias');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.entrada).toMatchObject({
      atendimento: 48001,
      unidade: null,
      ocorridoEm: '2026-10-22T08:30',
      chegouAoPaciente: true,
      danoPercebido: 'leve',
      anonima: false,
      origem: { tela: '/pep/48001/prontuario' },
    });
    expect(JSON.stringify(m.entrada)).not.toMatch(/nome/i);
  });

  it('"sem paciente" ou sem contexto exige a unidade; não chegou ao paciente vira dano nenhum', () => {
    const sem = montarNotificacao(form({ semPaciente: true }), { atendimento: 1 }, '/pep');
    expect(sem).toMatchObject({ ok: false, campo: 'unidade' });
    const ok = montarNotificacao(
      form({ unidade: 3, chegouAoPaciente: 'nao', danoPercebido: 'grave', anonima: true, local: ' Sala 2 ' }),
      null,
      '/inicio',
    );
    expect(ok.ok && ok.entrada).toMatchObject({
      atendimento: null,
      unidade: 3,
      local: 'Sala 2',
      chegouAoPaciente: false,
      danoPercebido: 'nenhum',
      anonima: true,
    });
  });

  it('diz o campo que falta, com o texto da tela', () => {
    expect(montarNotificacao(form({ chegouAoPaciente: '' }), null, '/')).toEqual({
      ok: false,
      campo: 'chegouAoPaciente',
      mensagem: mensagensQualidade.notificar.faltando.chegouAoPaciente,
    });
    expect(montarNotificacao(form({ hora: null }), { atendimento: 1 }, '/')).toMatchObject({
      campo: 'ocorridoEm',
    });
    expect(montarNotificacao(form({ tipo: '' }), { atendimento: 1 }, '/')).toMatchObject({ campo: 'tipo' });
    expect(montarNotificacao(form({ tipo: 'outro', tipoOutro: 'x' }), { atendimento: 1 }, '/')).toMatchObject(
      {
        campo: 'tipoOutro',
      },
    );
    expect(montarNotificacao(form({ danoPercebido: '' }), { atendimento: 1 }, '/')).toMatchObject({
      campo: 'danoPercebido',
    });
    expect(montarNotificacao(form({ descricao: 'curta' }), { atendimento: 1 }, '/')).toMatchObject({
      campo: 'descricao',
      mensagem: mensagensQualidade.notificar.faltando.descricao,
    });
    const outro = montarNotificacao(
      form({ tipo: 'outro', tipoOutro: ' Dieta trocada ' }),
      { atendimento: 1 },
      '/',
    );
    expect(outro.ok && outro.entrada.tipoOutro).toBe('Dieta trocada');
  });

  it('a tela de origem só com os caracteres aceitos, até 120', () => {
    expect(telaDeOrigem('/pep/1#topo')).toBe('/pep/1');
    expect(telaDeOrigem('/ação/x y')).toBe('/a--o/x-y');
    expect(telaDeOrigem('/' + 'a'.repeat(200))).toHaveLength(120);
    expect(telaDeOrigem('sem-barra')).toBe('/sem-barra');
  });

  it('o instante dos campos de data e hora', () => {
    expect(instanteDosCampos('2026-10-22', '08:30')).toBe('2026-10-22T08:30');
    expect(instanteDosCampos('2026-10-22', '08:30:15')).toBe('2026-10-22T08:30');
    expect(instanteDosCampos('2026-10-22', '0830')).toBe('2026-10-22T08:30');
    expect(instanteDosCampos(null, '08:30')).toBeNull();
    expect(instanteDosCampos('22/10/2026', '08:30')).toBeNull();
    expect(instanteDosCampos('2026-10-22', '8h')).toBeNull();
  });
});

describe('prazos e ações do NSP', () => {
  it('a duração curta (o sinal diz se venceu, a tela escolhe o texto)', () => {
    expect(duracaoCurta(40)).toBe('40 min');
    expect(duracaoCurta(-300)).toBe('5 h');
    expect(duracaoCurta(310)).toBe('5 h 10 min');
    expect(duracaoCurta(1440 * 2 + 180)).toBe('2 d 3 h');
    expect(duracaoCurta(1440)).toBe('1 d');
    expect(classeDoPrazo('vencido')).toBe('prazo prazo--vencido');
  });

  it('as datas da tela e o prazo sugerido', () => {
    expect(dataHora('2026-10-22T08:30:00')).toBe('22/10/2026 08:30');
    expect(dataHora('2026-10-22')).toBe('22/10/2026');
    expect(dataHora(null)).toBe('');
    expect(diasDepois('2026-12-15T10:00:00', 30)).toBe('2027-01-14');
  });

  it('as ações por situação seguem o fluxo do domínio', () => {
    expect(acoesDaSituacao('recebida')).toEqual({
      triar: true,
      distribuir: false,
      devolver: false,
      descartar: true,
      notivisa: false,
    });
    expect(acoesDaSituacao('triada')).toEqual({
      triar: true,
      distribuir: true,
      devolver: true,
      descartar: true,
      notivisa: true,
    });
    expect(acoesDaSituacao('distribuida')).toMatchObject({ triar: true, distribuir: true, descartar: false });
    expect(acoesDaSituacao('descartada')).toEqual({
      triar: false,
      distribuir: false,
      devolver: true,
      descartar: false,
      notivisa: false,
    });
  });
});

describe('os campos do Notivisa para copiar', () => {
  const campos: CamposNotivisa = {
    protocoloInterno: 'NSP-2026-000001',
    tipoIncidente: 'Queda',
    classificacao: 'Evento adverso',
    ocorridoEm: '2026-10-22T08:30',
    periodo: 'manha',
    unidade: 'Unidade sintética',
    local: null,
    descricao: 'Queda ao sair do leito.',
    dano: 'Leve',
    obito: false,
    neverEvent: false,
    paciente: { iniciais: 'P.S.Q.', sexo: 'F', idade: 46 },
    prazo: null,
  };
  const sn = (b: boolean) => (b ? 'Sim' : 'Não');

  it('na ordem do formulário, o paciente só com iniciais, sexo e idade', () => {
    const l = linhasDosCampos(
      campos,
      mensagensQualidade.prazos.campos,
      mensagensQualidade.prazos.periodos,
      sn,
    );
    expect(l.map((x) => x.chave)).toEqual([
      'protocoloInterno',
      'tipoIncidente',
      'classificacao',
      'ocorridoEm',
      'periodo',
      'unidade',
      'local',
      'dano',
      'obito',
      'neverEvent',
      'iniciais',
      'sexo',
      'idade',
      'descricao',
    ]);
    const texto = textoParaCopiar(l);
    expect(texto).toContain('Iniciais do paciente: P.S.Q.');
    expect(texto).toContain('Período do dia: Manhã (6h às 12h)');
    expect(texto).toContain('Local: -');
    expect(texto).toContain('Óbito: Não');
  });

  it('sem paciente, sem as linhas do paciente; idade desconhecida vira "-"', () => {
    const sem = linhasDosCampos({ ...campos, paciente: null }, {}, mensagensQualidade.prazos.periodos, sn);
    expect(sem.some((x) => x.chave === 'iniciais')).toBe(false);
    expect(sem[0]?.rotulo).toBe('protocoloInterno');
    const semIdade = linhasDosCampos(
      { ...campos, paciente: { iniciais: 'A.B.', sexo: 'I', idade: null } },
      {},
      mensagensQualidade.prazos.periodos,
      sn,
    );
    expect(semIdade.find((x) => x.chave === 'idade')?.valor).toBe('-');
  });
});
