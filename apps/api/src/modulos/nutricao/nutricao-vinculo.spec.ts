// Correções da revisão do M45.5, pelo controlador com a porta EM MEMÓRIA (sintética) e o relógio fixo:
//   - o corte, o jejum e os prazos são os da unidade CONSULTADA (regra 11: "corte por unidade"), não o setor da sessão;
//   - as leituras clínicas da triagem e da terapia conferem o vínculo assistencial (restrição do estabelecimento ligada);
//   - a fila do serviço social (risco e barreiras sociais) só com os pacientes com vínculo quando a restrição está ligada;
//   - a conta compartilhada (o login ligado a mais cadastros de profissional que o limite) não ganha a categoria: o
//     parecer social fica sob sigilo e a triagem é recusada (falha fechada).
// Dados sintéticos.
import type { ValorParametro } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { NutricaoController } from './nutricao.controller.js';
import { PortaNutricaoMemoria } from './porta-memoria.js';

const PERMISSOES = [
  'pep.nutricao.ler',
  'pep.nutricao.triar',
  'pep.terapiaNutricional.ler',
  'pep.terapiaNutricional.acompanhar',
  'hotelaria.mapaDieta.ler',
  'pep.social.ler',
  'pep.social.registrar',
];
const HOSPITAL = 'aa';

const valor = (chave: string, nivel: ValorParametro['nivel'], alvo: string, v: string): ValorParametro => ({
  id: `${chave}:${nivel}:${alvo}`,
  chave,
  nivel,
  alvo,
  valor: v,
  vigenteDesde: '2026-01-01',
  vigenteAte: null,
  justificativa: 'ajuste sintético de teste',
  autor: 'SINT.TESTE',
});

function montar(o: { restricao?: boolean; parametros?: ValorParametro[]; setor?: string | null } = {}) {
  const t = new RegistradorTrilhaMemoria();
  // 25/10/2026 às 15:00 (local).
  const porta = new PortaNutricaoMemoria(() => new Date(2026, 9, 25, 15, 0, 0));
  const ctrl = new NutricaoController(
    porta,
    t,
    new EstadoProntuario(),
    fonteConfiguracaoMemoria(t, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      parametrosIniciais: () => o.parametros ?? [],
    }),
    null,
    null,
    null,
    null,
    // O vínculo sintético: a nutricionista com 99.501 (950.001); a assistente social com 99.501 e 99.505.
    new VinculoSintetico([
      { login: 'SINT.NUTRI.CLINICA', idPaciente: 99_501, forma: 'equipe' },
      { login: 'SINT.SOCIAL', idPaciente: 99_501, forma: 'equipe' },
      { login: 'SINT.SOCIAL', idPaciente: 99_505, forma: 'equipe' },
    ]),
    null,
  );
  const req = (login: string) =>
    ({
      headers: {},
      ip: '127.0.0.1',
      sgh: {
        real: false,
        permissao: 'pep.nutricao.ler',
        ability: criarAbility(regrasDeAcesso(PERMISSOES, null)),
        sessao: {
          usuario: { id: '1', nome: 'Sintético', login },
          rede: 'rede-teste',
          estabelecimentos: [],
          estabelecimentoAtivo: HOSPITAL,
          unidadeAtiva: o.setor ?? null,
          permissoes: PERMISSOES,
          restricaoVinculo: o.restricao ?? false,
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
          expiraEm: '',
        },
      },
    }) as unknown as RequisicaoAutorizada;
  return { ctrl, porta, req };
}

const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number; getStatus?: () => number }) => e.getStatus?.() ?? e.status ?? 500,
  );

describe('o corte, o jejum e os prazos pela unidade consultada (regra 11; correção M45.5-1)', () => {
  const parametros = [
    valor('nutricao.corteAntecedenciaMin', 'unidade', 'UTI', '30'),
    valor('nutricao.cortesRefeicao', 'unidade', '2A', '2=08:00'),
    valor('nutricao.triagemPrazoHoras', 'unidade', 'UTI', '12'),
  ];

  it('o mapa de cada bloco com o corte dele, qualquer que seja o setor de quem consulta', async () => {
    for (const setor of [null, '2A', 'UTI']) {
      const m = montar({ parametros, setor });
      const uti = await m.ctrl.mapa(m.req('SINT.COPA'), 'UTI', '2', '2026-10-25');
      const enf = await m.ctrl.mapa(m.req('SINT.COPA'), '2A', '2', '2026-10-25');
      // UTI: 11:45 menos 30 min; 2A: o corte próprio do almoço.
      expect(uti.corteEm).toBe('2026-10-25T11:15');
      expect(enf.corteEm).toBe('2026-10-25T08:00');
      expect(uti.refeicao.corte).toBe('11:15');
    }
  });

  it('as opções da unidade escolhida trazem o corte dela; sem unidade, o do estabelecimento', async () => {
    const m = montar({ parametros, setor: '2A' });
    const uti = await m.ctrl.opcoesMapa(m.req('SINT.COPA'), 'UTI');
    const padrao = await m.ctrl.opcoesMapa(m.req('SINT.COPA'));
    expect(uti.refeicoes.find((r) => r.codigo === 2)?.corte).toBe('11:15');
    expect(padrao.refeicoes.find((r) => r.codigo === 2)?.corte).toBe('09:45');
  });

  it('a fila: cada internado com o prazo do bloco dele (a UTI com 12 h; as demais com 48 h)', async () => {
    const m = montar({ parametros });
    const f = await m.ctrl.fila(m.req('SINT.NUTRI.CLINICA'));
    const prazo = (reg: number) => {
      const i = f.itens.find((x) => x.internacao === reg)!;
      return (Date.parse(`${i.prazoEm}:00Z`) - Date.parse(`${i.admissao}:00Z`)) / 3_600_000;
    };
    expect(prazo(950_004)).toBe(12);
    expect(prazo(950_001)).toBe(48);
    const soUti = await m.ctrl.fila(m.req('SINT.NUTRI.CLINICA'), 'UTI');
    expect(soUti.prazoHoras).toBe(12);
  });
});

describe('as leituras clínicas e a fila social com a restrição por vínculo (correções M45.5-2 e M45.5-10)', () => {
  it('a triagem e a terapia de paciente sem vínculo: 403 com a restrição; sem ela, abertas', async () => {
    const com = montar({ restricao: true });
    const nutri = com.req('SINT.NUTRI.CLINICA');
    expect(await status(com.ctrl.triagens('950001', nutri))).toBe(200);
    expect(await status(com.ctrl.triagens('950004', nutri))).toBe(403);
    expect(await status(com.ctrl.terapia('950004', nutri))).toBe(403);
    expect(await status(com.ctrl.terapia('1', nutri))).toBe(404);
    const sem = montar({ restricao: false });
    expect(await status(sem.ctrl.terapia('950004', sem.req('SINT.NUTRI.CLINICA')))).toBe(200);
  });

  it('a fila social: com a restrição, só os pacientes com vínculo (o risco dos demais não sai)', async () => {
    const com = montar({ restricao: true });
    const nutri = await com.ctrl.filaSocial(com.req('SINT.NUTRI.CLINICA'));
    expect(nutri.itens.map((i) => i.internacao)).toEqual([950_001]);
    const social = await com.ctrl.filaSocial(com.req('SINT.SOCIAL'));
    expect(social.itens.map((i) => i.internacao).sort()).toEqual([950_001, 950_005]);
    const sem = montar({ restricao: false });
    expect((await sem.ctrl.filaSocial(sem.req('SINT.NUTRI.CLINICA'))).itens).toHaveLength(5);
  });
});

describe('a conta compartilhada não ganha a categoria (falha fechada; correção M45.5-11)', () => {
  it('a gravação mostra o motivo; a triagem é recusada; o parecer social fica sob sigilo', async () => {
    const m = montar();
    const g = await m.ctrl.gravacao(m.req('SINT.NUTRI.COMPARTILHADA'));
    expect(g.categoria).toBeNull();
    expect(g.operacoes['triar']).toMatchObject({ pode: false });
    expect(g.operacoes['triar']?.motivo).toMatch(/Conta compartilhada/);
    const gs = await m.ctrl.gravacaoSocial(m.req('SINT.SOCIAL.COMPARTILHADA'));
    expect(gs.operacoes['registrar']?.motivo).toMatch(/Conta compartilhada/);
    // A assistente social pessoal registra; a conta compartilhada lê o mesmo registro sem o parecer.
    const corpo = {
      internacao: 950_001,
      tipo: 'avaliacao',
      redeApoio: 'fragil',
      vulnerabilidades: ['idoso-sozinho'],
      risco: 'medio',
      encaminhamentos: ['familia'],
      parecer: 'Parecer social sintético: mora sozinha.',
      barreira: null,
    };
    await m.ctrl.registrarSocial(corpo, m.req('SINT.SOCIAL'));
    const pessoal = await m.ctrl.social('950001', m.req('SINT.SOCIAL'));
    expect(pessoal.registros[0]).toMatchObject({ sigilo: false });
    const compartilhada = await m.ctrl.social('950001', m.req('SINT.SOCIAL.COMPARTILHADA'));
    expect(compartilhada.daCategoria).toBe(false);
    expect(compartilhada.registros[0]).toMatchObject({ sigilo: true, parecer: null });
    const triar = m.ctrl.triar(
      {
        internacao: 950_002,
        respostas: {
          instrumento: 'nrs2002',
          imcAbaixoDe20e5: false,
          perdaDePeso3Meses: false,
          ingestaoReduzidaSemana: false,
          gravementeDoente: false,
          estadoNutricional: null,
          gravidade: null,
        },
      },
      m.req('SINT.NUTRI.COMPARTILHADA'),
    );
    expect(await status(triar)).toBe(403);
    expect(await status(m.ctrl.registrarSocial(corpo, m.req('SINT.SOCIAL.COMPARTILHADA')))).toBe(403);
  });

  it('o limite é parâmetro do estabelecimento (até 20): a conta de 150 cadastros segue compartilhada; a pessoal vale', async () => {
    const m = montar({
      parametros: [valor('nutricao.cadastrosPorLoginMax', 'estabelecimento', HOSPITAL, '20')],
    });
    // O limite máximo do parâmetro é 20; a conta sintética tem 150 cadastros: segue compartilhada.
    expect((await m.ctrl.gravacao(m.req('SINT.NUTRI.COMPARTILHADA'))).categoria).toBeNull();
    expect((await m.ctrl.gravacao(m.req('SINT.NUTRI.CLINICA'))).categoria).toBe('nutricao');
  });
});
