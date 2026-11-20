// W1-01 (parte 9b): a rotina das contas dormentes sobre a FONTE DA GESTÃO em memória (estado sintético), com o relógio
// simulado: contas e exceções pela fonte, bloqueio pelo executor da fonte (o estado sintético passa a bloqueado),
// exceção justificada incluída pela fonte (linha nova, recusas iguais às do legado), responsável = gestor ativo que
// entrou por último, trilha no registrador da API sem senha, hash nem token, parâmetros pela configuração.
import type { ValorParametro } from '@sgh/contratos';
import { PADRAO_DORMENCIA } from '@sgh/dominio-acesso';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ServicoContasDormentes } from './contas-dormentes.js';
import {
  parametrosDormenciaPelaConfiguracao,
  portaDormenciaDaFonte,
  responsavelDaFonte,
} from './contas-dormentes-porta.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';
import { type FonteGestao, fonteGestaoMemoria } from './gestao-fonte.js';

const HOJE = Date.parse('2026-11-18T12:00:00-03:00');
const trilhaGestao = {
  rede: 'rede',
  hospital: 'pc',
  usuario: 'SINT.GESTOR',
  evento: 'acesso.conta-dormente.excecao',
  recurso: 'acesso.usuario',
  operacao: 'acesso.excecaoContaDormente',
  resultado: 'sucesso',
  estacao: 'teste',
  correlacao: 'w101-9b',
};

describe('contas dormentes sobre a fonte da gestão em memória (W1-01 parte 9b)', () => {
  let fonte: FonteGestao;
  let trilha: RegistradorTrilhaMemoria;
  let servico: ServicoContasDormentes;
  let gestores: string[];
  let comuns: string[];

  beforeEach(async () => {
    reiniciarEstadoAcessoSintetico();
    trilha = new RegistradorTrilhaMemoria();
    fonte = fonteGestaoMemoria(trilha, { estado: () => 'verde' } as never, 'dev');
    gestores = (await fonte.gestoresAcesso('rede', 'pc')).map((g) => g.login);
    const contas = await fonte.contasDormencia('rede', 'pc');
    comuns = contas.map((c) => c.login).filter((l) => !gestores.includes(l));
    // Todos entraram ontem, menos dois comuns (200 dias sem entrar) e um gestor (há 10 dias).
    const est = estadoAcessoSintetico();
    for (const c of contas) est.ultimoAcesso.set(c.login, '2026-11-17');
    est.ultimoAcesso.set(comuns[0]!, '2026-05-02');
    est.ultimoAcesso.set(comuns[1]!, '2026-05-02');
    est.ultimoAcesso.set(gestores[0]!, '2026-11-08');
    servico = new ServicoContasDormentes({
      porta: portaDormenciaDaFonte({
        fonte: () => fonte,
        parametros: () => Promise.resolve(PADRAO_DORMENCIA),
        trilha,
      }),
      responsavel: responsavelDaFonte(() => fonte),
      agora: () => HOJE,
    });
  });
  afterEach(() => reiniciarEstadoAcessoSintetico());

  it('o responsável é o gestor ativo que entrou por último (não o de 10 dias atrás)', async () => {
    expect(gestores.length).toBeGreaterThan(1);
    const r = await responsavelDaFonte(() => fonte)('rede', 'pc');
    expect(r).not.toBe(gestores[0]);
    expect(gestores).toContain(r);
  });

  it('exceção pela fonte: linha nova, recusas do legado; a rodada poupa a excetuada e bloqueia a outra pelo executor', async () => {
    const recusa = (p: Promise<unknown>) =>
      p.then(
        () => 'gravou',
        (e: { problema?: { codigo?: string } }) => e.problema?.codigo,
      );
    const base = {
      hospital: 'pc',
      login: comuns[1]!,
      motivo: 'afastamento por licença médica',
      por: 'SINT.GESTOR',
    };
    expect(
      await recusa(
        fonte.registrarExcecaoDormencia('rede', 'pc', { ...base, ate: null, retirar: true }, trilhaGestao),
      ),
    ).toBe('sem-excecao');
    expect(
      await recusa(
        fonte.registrarExcecaoDormencia(
          'rede',
          'pc',
          { ...base, motivo: 'curto', ate: null, retirar: false },
          trilhaGestao,
        ),
      ),
    ).toBe('motivo-curto');
    expect(
      await recusa(
        fonte.registrarExcecaoDormencia(
          'rede',
          'pc',
          { ...base, login: 'NAO.EXISTE', ate: null, retirar: false },
          trilhaGestao,
        ),
      ),
    ).toBe('usuario-inexistente');
    const inc = await fonte.registrarExcecaoDormencia(
      'rede',
      'pc',
      { ...base, ate: '2027-01-31', retirar: false },
      trilhaGestao,
    );
    expect([inc.anterior, inc.atual]).toEqual([null, '2027-01-31']);
    expect(
      await recusa(
        fonte.registrarExcecaoDormencia(
          'rede',
          'pc',
          { ...base, ate: '2027-01-31', retirar: false },
          trilhaGestao,
        ),
      ),
    ).toBe('sem-mudanca');

    const previa = await servico.previa('rede', 'pc');
    expect(previa.bloquear.map((c) => c.login)).toEqual([comuns[0]]);
    expect(previa.poupadas.map((c) => [c.login, c.situacao])).toEqual([[comuns[1], 'excecao']]);

    const r = await servico.rodada('rede', 'pc');
    expect(r.motivo).toBeNull();
    expect(r.bloqueadas.map((c) => c.login)).toEqual([comuns[0]]);
    expect(r.falhas).toEqual([]);
    expect(estadoAcessoSintetico().bloqueio.get(comuns[0]!)).toBe(true);
    expect((await fonte.contasDormencia('rede', 'pc')).some((c) => c.login === comuns[0])).toBe(false);

    const eventos = trilha.eventos.map((e) => [e.evento, e.idAlvo ?? null, e.resultado]);
    expect(eventos).toContainEqual(['acesso.conta-dormente.excecao', inc.id, 'sucesso']);
    expect(eventos).toContainEqual(['acesso.conta-dormente.bloqueada', comuns[0], 'sucesso']);
    const rodada = trilha.eventos.find((e) => e.evento === 'acesso.contas-dormentes.rodada');
    expect(rodada?.chaveNaturalAlvo).toBe('dormentes: 1; bloqueadas: 1; falhas: 0; poupadas por exceção: 1');
    const texto = JSON.stringify(trilha.eventos);
    expect(texto).not.toMatch(/senha|hash|salt|token/i);

    // Segunda rodada no mesmo dia: nada mais a bloquear.
    const outra = await servico.rodada('rede', 'pc');
    expect(outra.bloqueadas).toEqual([]);
  });

  it('parâmetros pela configuração: valor do estabelecimento, padrão sem fonte e fora da faixa', async () => {
    const v = (chave: string, valor: string): ValorParametro =>
      ({
        id: chave,
        chave,
        nivel: 'estabelecimento',
        alvo: 'pc',
        valor,
        vigenteDesde: '2026-01-01',
        vigenteAte: null,
        justificativa: 'teste',
        autor: 'SINT.GESTOR',
      }) as ValorParametro;
    const valores = [
      v('acesso.contasDormentes.ligada', 'nao'),
      v('acesso.contasDormentes.diasPessoal', '60'),
      v('acesso.contasDormentes.diasDispositivo', '5'),
    ];
    const ler = parametrosDormenciaPelaConfiguracao(() => ({
      valoresParametro: () => Promise.resolve(valores),
    }));
    const p = await ler('rede', 'pc');
    expect(p.diasDispositivo).toBe(180);
    expect(await parametrosDormenciaPelaConfiguracao(() => null)('rede', 'pc')).toEqual(PADRAO_DORMENCIA);
    const falha = parametrosDormenciaPelaConfiguracao(() => ({
      valoresParametro: () => Promise.reject(new Error('fora')),
    }));
    expect(await falha('rede', 'pc')).toEqual(PADRAO_DORMENCIA);
    expect([p.ligada, p.diasPessoal]).toEqual([false, 60]);
  });
});
