// W1-01 (parte 9a): a rotina das contas dormentes com o RELÓGIO SIMULADO: bloqueia pelo executor (acesso.bloquearUsuario,
// uma chamada por conta), respeita a exceção justificada e o último gestor, grava a trilha de cada bloqueio e da rodada
// (sem senha, hash nem token) e avisa o gestor. Porta em memória; dados sintéticos.
import type { ContaDormenciaLida, ExcecaoDormenciaVigente, ParametrosDormencia } from '@sgh/dominio-acesso';
import { PADRAO_DORMENCIA } from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type AvisoDormencia,
  EVENTO_DORMENCIA_RODADA,
  EVENTO_DORMENTE_BLOQUEADA,
  type LinhaTrilhaDormencia,
  type PortaDormencia,
  ServicoContasDormentes,
} from './contas-dormentes.js';

const DIA = 86_400_000;
const conta = (login: string, ultimoAcesso: string | null, grupo = 'RECEPCAO'): ContaDormenciaLida => ({
  login,
  grupo,
  ativo: true,
  bloqueado: false,
  ultimoAcesso,
});

function montar(o: {
  contas: ContaDormenciaLida[];
  excecoes?: ExcecaoDormenciaVigente[];
  gestores?: string[];
  parametros?: ParametrosDormencia;
  receitaLigada?: boolean;
  falhar?: string;
}) {
  let relogio = Date.parse('2026-11-18T12:00:00-03:00');
  const executadas: { nome: string; entrada: unknown; usuario: string }[] = [];
  const trilha: LinhaTrilhaDormencia[] = [];
  const avisos: AvisoDormencia[] = [];
  const contas = o.contas.map((c) => ({ ...c }));
  const porta: PortaDormencia = {
    contas: () => Promise.resolve(contas.filter((c) => c.ativo && !c.bloqueado).map((c) => ({ ...c }))),
    excecoes: () => Promise.resolve(o.excecoes ?? []),
    gestoresAtivos: () => Promise.resolve(o.gestores ?? []),
    parametros: () => Promise.resolve(o.parametros ?? PADRAO_DORMENCIA),
    receita: () => ({
      ligada: o.receitaLigada ?? true,
      motivo: o.receitaLigada === false ? 'desligada' : null,
    }),
    executar(nome, _h, entrada, ctx) {
      const login = (entrada as { login: string }).login;
      if (login === o.falhar) return Promise.reject(new ErroOperacao(409, 'alterado', 'x', 'y'));
      executadas.push({ nome, entrada, usuario: ctx.responsavel });
      const c = contas.find((x) => x.login === login);
      if (c) Object.assign(c, { bloqueado: true });
      return Promise.resolve();
    },
    trilha: (_r, _h, l) => {
      trilha.push(l);
      return Promise.resolve();
    },
  };
  const s = new ServicoContasDormentes({
    porta,
    agora: () => relogio,
    responsavel: () => Promise.resolve('SINT.GESTOR'),
    avisar: (a) => {
      avisos.push(a);
      return Promise.resolve();
    },
  });
  return {
    s,
    executadas,
    trilha,
    avisos,
    avancar: (dias: number) => {
      relogio += dias * DIA;
    },
  };
}

describe('W1-01 (parte 9a): rotina das contas dormentes (relógio simulado)', () => {
  it('a conta passa de 90 dias sem entrar: o relógio avança e a rodada seguinte bloqueia pelo executor', async () => {
    const m = montar({ contas: [conta('SINT.A', '2026-08-20'), conta('SINT.B', '2026-11-01')] });
    let r = await m.s.rodada('rede-teste', 'pc');
    expect(r).toMatchObject({ hoje: '2026-11-18', ligada: true, bloqueadas: [] });
    expect(m.executadas).toEqual([]);
    m.avancar(1); // 2026-11-19: SINT.A com 91 dias
    r = await m.s.rodada('rede-teste', 'pc');
    expect(r.bloqueadas.map((c) => c.login)).toEqual(['SINT.A']);
    expect(m.executadas).toEqual([
      { nome: 'acesso.bloquearUsuario', entrada: { login: 'SINT.A' }, usuario: 'SINT.GESTOR' },
    ]);
    const t = m.trilha.filter((x) => x.evento === EVENTO_DORMENTE_BLOQUEADA);
    expect(t).toEqual([
      {
        evento: EVENTO_DORMENTE_BLOQUEADA,
        login: 'SINT.A',
        resultado: 'sucesso',
        diferenca: 'conta pessoal sem acesso há 91 dias (último: 2026-08-20); limite: 90',
      },
    ]);
    expect(m.avisos.at(-1)?.bloqueadas.map((c) => c.login)).toEqual(['SINT.A']);
    // Já bloqueada: a rodada seguinte não repete.
    m.avancar(1);
    r = await m.s.rodada('rede-teste', 'pc');
    expect(r.bloqueadas).toEqual([]);
    expect(m.executadas).toHaveLength(1);
  });

  it('exceção justificada poupa até o prazo; vencida, a conta cai', async () => {
    const m = montar({
      contas: [conta('SINT.A', '2026-01-01')],
      excecoes: [{ login: 'SINT.A', ate: '2026-11-20', motivo: 'licença médica' }],
    });
    let r = await m.s.rodada('rede-teste', 'pc');
    expect(r.bloqueadas).toEqual([]);
    expect(r.poupadas).toMatchObject([
      { login: 'SINT.A', situacao: 'excecao', motivoExcecao: 'licença médica' },
    ]);
    expect(m.trilha.at(-1)).toMatchObject({
      evento: EVENTO_DORMENCIA_RODADA,
      diferenca: 'dormentes: 0; bloqueadas: 0; falhas: 0; poupadas por exceção: 1',
    });
    m.avancar(3); // 2026-11-21
    r = await m.s.rodada('rede-teste', 'pc');
    expect(r.bloqueadas.map((c) => c.login)).toEqual(['SINT.A']);
  });

  it('o último gestor ativo fica; a falha de uma conta não para as outras e vai à trilha', async () => {
    const m = montar({
      contas: [conta('SINT.G', '2026-01-01'), conta('SINT.U', '2026-01-01'), conta('SINT.V', '2026-01-01')],
      gestores: ['SINT.G'],
      falhar: 'SINT.U',
    });
    const r = await m.s.rodada('rede-teste', 'pc');
    expect(r.bloqueadas.map((c) => c.login)).toEqual(['SINT.V']);
    expect(r.falhas).toEqual([{ login: 'SINT.U', codigo: 'alterado' }]);
    expect(r.poupadas).toMatchObject([{ login: 'SINT.G', situacao: 'ultimo-gestor' }]);
    expect(m.trilha).toContainEqual({
      evento: EVENTO_DORMENTE_BLOQUEADA,
      login: 'SINT.U',
      resultado: 'falha',
      diferenca: 'falha: alterado',
    });
    expect(m.avisos[0]?.falhas).toEqual([{ login: 'SINT.U', codigo: 'alterado' }]);
  });

  it('desligada (parâmetro ou operação): não bloqueia, registra o motivo e a prévia continua', async () => {
    const m = montar({
      contas: [conta('SINT.A', '2026-01-01')],
      parametros: { ...PADRAO_DORMENCIA, ligada: false },
    });
    const r = await m.s.rodada('rede-teste', 'pc');
    expect(r).toMatchObject({ ligada: false, bloqueadas: [] });
    expect(r.motivo).toMatch(/desligada/);
    expect(m.executadas).toEqual([]);
    expect((await m.s.previa('rede-teste', 'pc')).previa.map((c) => c.login)).toEqual(['SINT.A']);
    expect(m.trilha.at(-1)?.diferenca).toMatch(/^não bloqueou: Rotina desligada.*dormentes: 1$/);
    const n = montar({ contas: [conta('SINT.A', '2026-01-01')], receitaLigada: false });
    expect(await n.s.rodada('rede-teste', 'pc')).toMatchObject({ ligada: false, motivo: 'desligada' });
    expect(n.executadas).toEqual([]);
  });

  it('a trilha e o aviso não levam senha, hash, sal nem token', async () => {
    const m = montar({ contas: [conta('SINT.A', '2026-01-01'), conta('SINT.TV', '2026-01-01', 'PAINEIS')] });
    await m.s.rodada('rede-teste', 'pc');
    const tudo = JSON.stringify([m.trilha, m.avisos]);
    expect(tudo).not.toMatch(/senha|hash|salt|\bsal\b|token/i);
    expect(m.avisos[0]?.bloqueadas.map((c) => [c.login, c.tipo])).toEqual([
      ['SINT.A', 'pessoal'],
      ['SINT.TV', 'dispositivo'],
    ]);
  });
});
