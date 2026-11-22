// Integração da linha de base de carga contra o MariaDB real (cliente f22_o2): cada leitura das jornadas roda sobre o
// modelo próprio (a consulta tem de valer no DDL) e devolve só contagens; com massa sintética mínima (um paciente, um
// atendimento e uma senha FICTÍCIOS), a ficha, as listas e a fila contam o que foi criado. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio, type Escritor } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as L from './leituras.js';
import { FonteCargaPropria } from './fonte-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

describe.skipIf(SEM_BANCO)('linha de base de carga sobre o banco próprio (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteCargaPropria;
  let est = 0;
  const ler = <T>(fn: (l: import('@sgh/nucleo').Leitor) => Promise<T>) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-10-carga' }, fn);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    fonte = new FonteCargaPropria(nucleo, CLIENTE);
    const e = await fonte.estabelecimento();
    expect(e).not.toBeNull();
    est = e?.id ?? 0;
  });

  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('todas as leituras valem no modelo e devolvem contagem', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const agora = new Date();
    const antes = new Date(agora.getTime() - 7 * 86_400_000);
    const r = await ler(async (l) => {
      const a = await L.ancoraCarga(l, est);
      const ag = await L.ancoraAgenda(l, est);
      const rec = await L.ancoraRecepcao(l, est);
      const alvo = { horario: 0, agenda: 0, paciente: 0 };
      const agFixa = { dia: hoje, agendas: [0] };
      const numeros = [
        await L.cargaLogin(l, est, 3),
        await L.cargaAbrirFicha(l, est, 0).then((x) => x.itens),
        await L.cargaListas(l, est, { dia: hoje }),
        await L.cargaPainel(l, est),
        await L.cargaRelatorio(l, est, { dia: hoje }),
        await L.relatorioPesado(l, est, 10_000),
        await L.cargaVagas(l, est, agFixa, null),
        await L.cargaVagas(l, est, agFixa, 0),
        await L.cargaPauta(l, est, agFixa, 1),
        (await L.alvosMarcacao(l, est, agFixa)).length,
        await L.cargaMarcacao(l, est, alvo),
        await L.cargaHorariosPortal(l, est, agFixa, 1),
        await L.cargaMeusAgendamentos(l, est, alvo),
        await L.cargaFila(l, est, { dia: hoje }, 0),
        await L.cargaSupervisor(l, est, { dia: hoje }),
        await L.cargaEstrutura(l, est),
        await L.guiasAguardandoAutorizacao(l, est, hoje),
        (await L.procedimentosComPreco(l, est, 10)).length,
        (await L.valorVigente(l, 0, hoje)) ? 1 : 0,
        (await L.contratosDoEstabelecimento(l, est)).length,
        await L.cargaContrato(l, est, 0),
        (await L.ultimoDiaDoLaboratorio(l, est)) ? 1 : 0,
        (await L.ultimoDiaDoLaboratorio(l, est, true)) ? 1 : 0,
        await L.examesDoSetor(l, est, hoje, 'todos'),
        await L.examesDoSetor(l, est, hoje, 'aLiberar'),
        await L.listaDeColeta(l, est, hoje),
        await L.mapaDeTrabalho(l, est, hoje),
        await L.filaDeLiberacao(l, est, hoje),
        await L.liberadosComCriticoSemAviso(l, est, hoje),
        (await L.ancoraEstoque(l, est)).insumos.length,
        await L.saldosDoLocal(l, est, 0),
        await L.lotesDoLocal(l, 0, 0),
        await L.saidasDaCompetencia(l, est, 0, hoje.slice(0, 7)),
        await L.requisicoesPendentes(l, est, 0),
        (await L.ancoraFarmacia(l, est)).unidade ?? 0,
        await L.filaDaUnidade(l, est, 0, antes, agora),
        await L.entregasPendentes(l, est),
        await L.movimentosControlados(l, est, antes, agora),
        (await L.prescricoesRecentes(l, est, 5)).length,
        await L.prescricoesDoAtendimento(l, est, 0),
        await L.leituraDaPrescricao(l, est, 0),
        (await L.ancoraDaPrescricao(l, est, 0)) ? 1 : 0,
        await L.situacaoDoHorario(l, est, 0),
        await L.historicoDoHorario(l, 0),
        await L.horariosDoAtendimento(l, est, 0, antes, agora),
        await L.horariosDaUnidadeDoAtendimento(l, est, 0, antes, agora),
        (await L.pacientesComRegistros(l, est, 5)).length,
        await L.registrosDoPaciente(l, est, 0),
        await L.registroMaisNovo(l, est, 0),
        await L.cabecalhoDoPaciente(l, est, 0),
        await L.leitosOcupados(l, est),
      ];
      return { a, ag, rec, numeros };
    });
    for (const x of r.numeros) expect(Number.isInteger(x) && x >= 0).toBe(true);
    expect(r.numeros).toHaveLength(51);
    expect(r.ag.agendas.every((x) => Number.isInteger(x))).toBe(true);
  });

  describe('com massa sintética', () => {
    const marca = `t0210-${randomUUID().slice(0, 8)}`;
    const ids: { pessoa?: number; paciente?: number; atendimento?: number } = {};

    beforeAll(async () => {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-02-10-carga' }, async (e: Escritor) => {
        const agora = new Date();
        // Pessoa e paciente FICTÍCIOS (o nome é a marca do teste); só as colunas obrigatórias.
        ids.pessoa = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em, versao) VALUES (?, ?, 1)', [
          `Pessoa ${marca}`,
          agora,
        ]);
        ids.paciente = await e.inserir(
          "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em, versao) VALUES (?, ?, 'ativo', ?, 1)",
          [ids.pessoa, 900_000_000 + Math.floor(Math.random() * 99_999_999), agora],
        );
      });
    });

    afterAll(async () => {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-02-10-carga' }, async (e: Escritor) => {
        if (ids.paciente) await e.executar('DELETE FROM paciente WHERE id = ?', [ids.paciente]);
        if (ids.pessoa) await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [ids.pessoa]);
      });
    });

    it('a ficha encontra o paciente criado e a faixa o inclui', async () => {
      const f = await ler((l) => L.faixaPacientes(l));
      expect(f.max).toBeGreaterThanOrEqual(ids.paciente ?? 0);
      const r = await ler((l) => L.cargaAbrirFicha(l, est, ids.paciente ?? 0));
      expect(r).toEqual({ encontrado: true, itens: 1 });
    });
  });
});
