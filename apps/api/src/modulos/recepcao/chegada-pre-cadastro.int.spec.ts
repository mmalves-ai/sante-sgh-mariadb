// 02-AGE 42, contrato de efeito da conversão ali mesmo (painel do dia e chegada): a marcação feita sem prontuário
// aparece na leitura da agenda com o pré-cadastro a converter (regra preCadastroAConverter); a chegada recusa a
// marcação sem paciente (`pre-cadastro-a-converter`) sem gravar nada; convertido o pré-cadastro (a mesma operação que
// a tela chama na hora), a chegada passa e fica no banco: marcacao_horario.paciente_id preenchido (o vínculo com o
// pré-cadastro continua, histórico), pre_cadastro `convertido` com o paciente e a senha ligada à marcação. Massa
// SINTÉTICA da recepção (rc0101a), limpa antes e depois; a marcação da massa volta ao paciente sem pré-cadastro no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroVinculosProprio } from '../cadastro/paciente-vinculos-proprio.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaAgendaPropria } from '../agenda/porta-propria.js';
import { marcacaoVista } from '../agenda/visao.js';
import {
  CLIENTE,
  CODIGO_EST,
  garantirCliente,
  limparMovimento,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import { PortaRecepcaoPropria } from './porta-propria.js';
import type { ContextoGravacao } from './tipos.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
const g = (): ContextoGravacao => {
  const chave = `age42c-${randomUUID()}`;
  return { login: LOGIN, correlacao: chave.slice(0, 40), chaveIdempotencia: chave };
};

describe.skipIf(SEM_BANCO)('02-AGE 42: conversão do pré-cadastro na chegada (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRecepcaoPropria;
  let agenda: PortaAgendaPropria;
  let m: Massa;
  let pre = 0;
  const um = async (sql: string, p: unknown[]) =>
    (
      await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-age42c' }, (l) =>
        l.consultar<Record<string, unknown>>(sql, p),
      )
    )[0];
  const desfazerMassa = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-age42c' }, async (e) => {
      await e.executar('UPDATE marcacao_horario SET paciente_id = ?, pre_cadastro_id = NULL WHERE id = ?', [
        m.paciente,
        m.marcacao,
      ]);
      await e.executar(
        "DELETE FROM pre_cadastro WHERE estabelecimento_id = ? AND observacao = 'sintetico age42c'",
        [m.est],
      );
    });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
    agenda = new PortaAgendaPropria(nucleo, CLIENTE);
    await limparMovimento(nucleo, m);
    await desfazerMassa();
    // A marcação de hoje da massa passa a ser "sem prontuário": pré-cadastro pendente com o nome e o nascimento do
    // paciente sintético (a conversão o reconhece) e a marcação sem paciente.
    pre = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-age42c' }, async (e) => {
      const id = await e.inserir(
        `INSERT INTO pre_cadastro (estabelecimento_id, nome, data_nascimento, celular, situacao, observacao, criado_em)
         VALUES (?, 'PESSOA SINTETICA AGE42C', '1981-04-02', '31999910142', 'pendente', 'sintetico age42c', ?)`,
        [m.est, new Date()],
      );
      await e.executar('UPDATE marcacao_horario SET paciente_id = NULL, pre_cadastro_id = ? WHERE id = ?', [
        id,
        m.marcacao,
      ]);
      return Number(id);
    });
  });
  afterAll(async () => {
    if (m) {
      await limparMovimento(nucleo, m);
      await desfazerMassa();
    }
    await nucleo?.encerrar();
  });

  it('a agenda mostra o pré-cadastro a converter; a chegada recusa; convertido ali mesmo, a chegada grava com o paciente', async () => {
    const ctxAgenda = { ...c, login: LOGIN };
    const antes = await agenda.marcacao(ctxAgenda, m.marcacao);
    expect(antes?.marcacao).toMatchObject({
      idPaciente: null,
      preCadastro: pre,
      situacaoPreCadastro: 'pendente',
    });
    expect(marcacaoVista(antes!.marcacao).preCadastroAConverter).toBe(pre);

    const senha = Number(
      (
        await porta.executar(
          c,
          'recepcao.emitirSenha',
          { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
          g(),
        )
      ).resultado['senha'],
    );
    await expect(
      porta.executar(c, 'recepcao.registrarChegada', { senha, tipo: 'consulta', marcacao: m.marcacao }, g()),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'pre-cadastro-a-converter' }) });
    const ligadas = await um(
      'SELECT COUNT(*) AS n FROM senha_emitida_marcacao WHERE marcacao_horario_id = ?',
      [m.marcacao],
    );
    expect(Number(ligadas?.['n'])).toBe(0);
    expect(await um('SELECT chegada_em FROM marcacao_horario WHERE id = ?', [m.marcacao])).toMatchObject({
      chegada_em: null,
    });

    // A conversão que o painel do dia e o guichê chamam na hora (liga ao paciente achado; o nome difere: com motivo).
    const v = new CadastroVinculosProprio(nucleo, CLIENTE);
    const trilha: RegistroTrilhaTela = {
      estabelecimento: m.est,
      usuario: m.usuario,
      acao: 'operacao',
      entidade: 'pre_cadastro',
      entidadeId: null,
      dadosDepois: { evento: 'teste', recurso: 'cadastro.pre-cadastro' },
      correlacao: 'age42c-converter',
    };
    const r = await v.converterPreCadastro(
      { ...c, cliente: CLIENTE, estabelecimento: m.est, usuario: m.usuario, correlacao: 'age42c-converter' },
      { id: pre, paciente: m.paciente, motivoDivergencia: 'Documento conferido no guichê (sintético)' },
      trilha,
    );
    expect(r).toMatchObject({ paciente: m.paciente, marcacoes: 1 });
    const k = await um('SELECT situacao, paciente_id, convertido_em FROM pre_cadastro WHERE id = ?', [pre]);
    expect(k?.['situacao']).toBe('convertido');
    expect(Number(k?.['paciente_id'])).toBe(m.paciente);
    expect(k?.['convertido_em']).not.toBeNull();

    const depois = await agenda.marcacao(ctxAgenda, m.marcacao);
    expect(depois?.marcacao).toMatchObject({ idPaciente: m.paciente, preCadastro: pre });
    expect(marcacaoVista(depois!.marcacao).preCadastroAConverter).toBeNull();

    await porta.executar(
      c,
      'recepcao.registrarChegada',
      { senha, tipo: 'consulta', marcacao: m.marcacao },
      g(),
    );
    const marc = await um(
      'SELECT paciente_id, pre_cadastro_id, chegada_em, situacao_marcacao_id FROM marcacao_horario WHERE id = ?',
      [m.marcacao],
    );
    expect(Number(marc?.['paciente_id'])).toBe(m.paciente);
    expect(Number(marc?.['pre_cadastro_id'])).toBe(pre);
    expect(Number(marc?.['situacao_marcacao_id'])).toBe(m.situacaoChegou);
    expect(marc?.['chegada_em']).not.toBeNull();
    const ligada = await um(
      'SELECT COUNT(*) AS n FROM senha_emitida_marcacao WHERE marcacao_horario_id = ? AND senha_emitida_id = ?',
      [m.marcacao, senha],
    );
    expect(Number(ligada?.['n'])).toBe(1);
  });
});
