// 02-REC linha 30 (C1-019): a abertura do atendimento pela porta em MEMÓRIA montada pelo módulo (o caminho do dev e do
// E2E sem banco). A porta confere o paciente no cadastro em memória do processo: sem essa ligação, toda abertura caía em
// "paciente inexistente" e a tela mostrava o erro genérico (500). Prova também que o paciente que não existe sai como
// 404 com a mensagem, nunca como 500. Massa SINTÉTICA.
import { ErroOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { problemaDoCadastro } from '../cadastro/comum.js';
import {
  cadastroMemoriaAtual,
  lembrarCadastroMemoria,
  PortaCadastroMemoria,
} from '../cadastro/porta-memoria.js';
import { portaDoAtendimento } from './modulo.js';

const ctxModulo = {
  nucleo: null,
  configuracao: { clientePadrao: null },
  env: { AMBIENTE: 'ci', ACESSO_FONTE_DEV: 'sintetica' },
} as never;

const c = {
  cliente: 'teste',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'abertura',
  rede: 'r',
  hospital: 'h',
};
let n = 0;
const g = () => ({ ...c, chaveIdempotencia: `abertura-${++n}`, login: 'SINT.ATENDIMENTO', estacao: 'TESTE' });

const consulta = (paciente: number) => ({
  tipo: 'consulta',
  paciente,
  convenio: 306,
  profissional: 7101,
  especialidade: 15,
  unidade: 1,
  centroCusto: 300600,
  procedimento: 10101012,
  carater: 'eletivo',
  cidPrincipal: 1,
});

describe('abertura do atendimento pela porta em memória do módulo', () => {
  it('abre a consulta do paciente do cadastro em memória e lança o extra na conta', async () => {
    const porta = await portaDoAtendimento(ctxModulo);
    expect(porta.destino).toBe('memoria');
    const r = await porta.executar(c as never, 'atendimento.abrirAtendimento', consulta(1001), g() as never);
    const reg = Number((r.resultado as { reg: number }).reg);
    expect(reg).toBeGreaterThan(0);
    const extra = await porta.executar(
      c as never,
      'atendimento.lancarProcedimentoExtra',
      { atendimento: reg, procedimento: 40301630, quantidade: 2 },
      g() as never,
    );
    expect(extra.resultado).toMatchObject({ reg, seq: 1, quantidade: 2 });
  });

  it('lê o mesmo cadastro em memória do processo (o que a busca da recepção usa)', async () => {
    const anterior = cadastroMemoriaAtual();
    const cadastro = lembrarCadastroMemoria(new PortaCadastroMemoria());
    try {
      const porta = await portaDoAtendimento(ctxModulo);
      const [p] = await cadastro.lerPacientes(c as never, [1001]);
      expect(p?.id).toBe(1001);
      const r = await porta.executar(
        c as never,
        'atendimento.abrirAtendimento',
        consulta(1001),
        g() as never,
      );
      expect(Number((r.resultado as { reg: number }).reg)).toBeGreaterThan(0);
    } finally {
      if (anterior) lembrarCadastroMemoria(anterior);
    }
  });

  it('o paciente que não existe é recusado com 404 e a mensagem, nunca 500', async () => {
    const porta = await portaDoAtendimento(ctxModulo);
    const erro = await porta
      .executar(c as never, 'atendimento.abrirAtendimento', consulta(999_999), g() as never)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(erro).toBeInstanceOf(ErroOperacao);
    const p = problemaDoCadastro(erro);
    expect(p.getStatus()).toBe(404);
    expect(p.tipo).toBe('nao-encontrado');
    expect(p.detalhe).toBe('O cadastro do paciente não existe mais.');
  });
});
