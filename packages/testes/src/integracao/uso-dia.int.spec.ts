// Integração do M37 na cópia (ficha, seções 4, 6 e 10; regras 1 e 2), tudo em transação DESFEITA:
//   (1) parcela do dia por operação: as linhas do dia na tabela principal (senhas) gravadas pelo outro sistema
//       simulado e pelo executor do novo; a SGH_TRILHA atribui ao novo só as dele; a conta é só COUNT e a tela imprime
//       "novo x de y"; na agenda, a marcação feita hoje para a semana que vem conta HOJE (DT_AGE, a data da marcação),
//       nos dois lados da conta, e não no dia da consulta;
//   (2) retratos da tabela de conexões alterada pelo outro sistema simulado: o primeiro retrato do dia, o segundo sem
//       mudança e o terceiro com a conexão nova ("mudou"), e os dias desde a última conexão;
//   (3) MON$ATTACHMENTS com conexões de mais de um sistema (o novo e o outro simulado, pela marca da conexão);
//   (4) as gravações SGH_ do marco (setor e composição, trilha versionada, conclusão, chamado) e o lote de 50 usuários
//       que liga e recolhe inteiro (o estado de antes restaurado; DP-4).
import {
  calcularParcela,
  diasDesdeUltimaConexao,
  planejarLote,
  retratoDoDia,
  reverterLote,
  textoParcela,
} from '@sgh/dominio-config';
import {
  abrirChamado,
  aplicarLoteCoexistencia,
  carregarDominiosVistos,
  coletar,
  contarUsoDoDia,
  gravarRetratoConexoes,
  gravarSetorCoex,
  gravarUsoDia,
  lerChamados,
  lerChavesLiberacao,
  lerConclusoesTreino,
  lerConexoesOutroSistema,
  lerLotesCoex,
  lerRetratoAnterior,
  lerRetratosConexao,
  lerSetoresCoex,
  lerTrilhasCoex,
  lerUsoDia,
  MEDIDAS_USO,
  operacao,
  publicarTrilhaCoex,
  recolherLoteCoexistencia,
  registrarConclusoesTreino,
  relogioDoBanco,
} from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agendaLivre,
  convenioAceito,
  diaUtil,
  entradaGrade,
  relogio as relogioAgenda,
} from '../massa/reproducao-agenda.js';
import { outroSistemaConecta, outroSistemaEmiteSenha } from '../massa/coexistencia-outro-sistema.js';
import { geradorLivre } from '../massa/reproducao-recepcao.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  criarNucleo,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const DIA_UTC = (d: Date) => d.toISOString().slice(0, 10);
const trilhaBase = (a: Ambiente, operacaoDaTrilha: string) => ({
  rede: a.nucleo.rede,
  hospital: a.cod,
  usuario: 'SGH.M37',
  evento: 'coexistencia.lote.aplicado',
  recurso: 'config.coexistencia',
  operacao: operacaoDaTrilha,
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: 'SGH-TESTE:integracao',
  correlacao: `integracao-m37-${Date.now().toString(36)}`,
});

describe.skipIf(!PODE_ESCREVER)('painel de migração na cópia (M37)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('parcela do dia: o outro sistema e o novo gravam senhas; a trilha separa as do novo (só COUNT)', async () => {
    const medida = MEDIDAS_USO.find((m) => m.operacao === 'recepcao.emitirSenha')!;
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const hoje = DIA_UTC(await relogioDoBanco(e));
      // O usuário do balcão (sintético, pelo executor; a senha do outro sistema leva o login de quem emitiu).
      const balcao = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', balcao),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const antes = await contarUsoDoDia(e, a.cod, medida, hoje);
      // Números altos, longe da numeração do dia (a senha é única por gerador e dia).
      const base = 9_000 + (Date.now() % 800);
      await outroSistemaEmiteSenha(e, balcao, base);
      await outroSistemaEmiteSenha(e, balcao, base + 1);
      const g = await geradorLivre(e);
      await a.executor.executar(
        operacao('recepcao.emitirSenha'),
        a.cod,
        { gerador: g.id, prioridade: '2', origem: 'balcao' },
        // O operador da senha é o usuário do balcão (a senha leva o login de quem emitiu: FK para os usuários).
        ctxOperacao(a, balcao),
        { escritor: e },
      );
      const depois = await contarUsoDoDia(e, a.cod, medida, hoje);
      expect(depois.linhasDoDia - antes.linhasDoDia).toBe(3);
      expect(depois.doNovo - antes.doNovo).toBe(1);
      const p = calcularParcela(depois.linhasDoDia, depois.doNovo);
      expect(p.novo + p.legado).toBe(p.total);
      await gravarUsoDia(e, a.cod, [
        { dia: hoje, setor: medida.setor, operacao: medida.operacao, noNovo: p.novo, noLegado: p.legado },
      ]);
      await gravarUsoDia(e, a.cod, [
        { dia: hoje, setor: medida.setor, operacao: medida.operacao, noNovo: p.novo, noLegado: p.legado },
      ]);
      const lido = (await lerUsoDia(e, a.cod, hoje)).filter((u) => u.operacao === medida.operacao);
      expect(lido).toHaveLength(1);
      expect(lido[0]).toMatchObject({ noNovo: p.novo, noLegado: p.legado });
      console.log(`[M37] parcela das senhas do dia na cópia (transação desfeita): ${textoParcela(p)}`);
    });
  }, 300_000);

  it('parcela da agenda: marcar hoje uma consulta da semana que vem soma 1 hoje nos dois lados (DT_AGE), 0 no dia dela', async () => {
    const medida = MEDIDAS_USO.find((m) => m.operacao === 'agenda.agendarConsulta')!;
    expect(medida).toMatchObject({ tabela: 'REPACAGD', coluna: 'DT_AGE', setor: 'agendamento' });
    const tiposLogradouro =
      carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos(
        'RICADPAC',
        'TPLGR',
      ) ?? new Set<string>();
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = (await loginLivre(e, (Date.now() + 31) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', usuario),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
      const ag = await agendaLivre(e);
      const hoje = (await relogioAgenda(e)).hoje;
      const semanaQueVem = new Date(Date.parse(`${hoje}T00:00:00Z`) + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const dia = await diaUtil(e, ag, semanaQueVem);
      expect(dia > hoje).toBe(true);
      await exec('agenda.gerarGrade', entradaGrade(ag, dia));
      const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
      const pac = await exec(
        'cadastro.cadastrarPaciente',
        pacienteSintetico('com-cep', cpf, await cepCompleto(e, tiposLogradouro)),
      );
      const antesHoje = await contarUsoDoDia(e, a.cod, medida, hoje);
      const antesDia = await contarUsoDoDia(e, a.cod, medida, dia);
      await exec('agenda.agendarConsulta', {
        agenda: ag.id,
        data: dia,
        hora: '0700',
        paciente: Number(pac.resultado['idPaciente']),
        convenio: await convenioAceito(e, ag),
        retorno: false,
        canal: 'telefone',
      });
      const depoisHoje = await contarUsoDoDia(e, a.cod, medida, hoje);
      const depoisDia = await contarUsoDoDia(e, a.cod, medida, dia);
      expect(depoisHoje.linhasDoDia - antesHoje.linhasDoDia).toBe(1);
      expect(depoisHoje.doNovo - antesHoje.doNovo).toBe(1);
      expect(depoisDia.linhasDoDia - antesDia.linhasDoDia).toBe(0);
      const p = calcularParcela(depoisHoje.linhasDoDia, depoisHoje.doNovo);
      expect(p.novo).toBeLessThanOrEqual(p.total);
      console.log(`[M37] parcela da agenda de hoje na cópia (transação desfeita): ${textoParcela(p)}`);
    });
  }, 300_000);

  it('retratos das conexões: o primeiro do dia, sem mudança e com conexão nova; dias desde a última', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, (Date.now() + 17) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await outroSistemaConecta(e, login, 1, -86_400 * 3);
      const agora = await relogioDoBanco(e);
      const hoje = DIA_UTC(agora);
      const dele = async () => (await lerConexoesOutroSistema(e)).filter((x) => x.login === login);
      const r1 = retratoDoDia(hoje, await dele(), [], 'UTC');
      expect(r1).toEqual([expect.objectContaining({ login, modulo: 1, mudou: false })]);
      await gravarRetratoConexoes(e, a.cod, r1);
      expect(
        diasDesdeUltimaConexao(
          (await dele()).map((x) => x.ultima),
          hoje,
          'UTC',
        ),
      ).toBe(3);
      // Sem nova conexão: o retrato seguinte não muda.
      const ant = (await lerRetratoAnterior(e, a.cod, hoje)).filter((x) => x.login === login);
      expect(retratoDoDia(hoje, await dele(), ant, 'UTC')[0]?.mudou).toBe(false);
      // O outro sistema regrava a última conexão (login de hoje): o retrato marca a mudança.
      await outroSistemaConecta(e, login, 1, 0);
      const r3 = retratoDoDia(hoje, await dele(), ant, 'UTC');
      expect(r3[0]?.mudou).toBe(true);
      await gravarRetratoConexoes(e, a.cod, r3);
      const lidos = (await lerRetratosConexao(e, a.cod, hoje)).filter((x) => x.login === login);
      expect(lidos).toEqual([expect.objectContaining({ mudou: true })]);
      expect(
        diasDesdeUltimaConexao(
          (await dele()).map((x) => x.ultima),
          hoje,
          'UTC',
        ),
      ).toBe(0);
    });
  }, 300_000);

  it('MON$: conexões do novo e do outro sistema simulado contadas por sistema', async () => {
    // Uma conexão do outro sistema simulado (pela marca) e outra do novo seguradas abertas; o coletor (que não conta a
    // própria conexão) vê as duas, cada uma no seu sistema.
    const outro = criarNucleo({ SGH_MARCA_CONEXAO: 'legado-simulado:m37', FB_POOL_TETO: '1' });
    const novo = criarNucleo({ FB_POOL_TETO: '1' });
    try {
      await outro.lerSomente(ctx(a), () =>
        novo.lerSomente(ctx(a), async () => {
          const c = await a.nucleo.lerSomente(ctx(a), (l) => coletar(l, { estabelecimento: a.cod }));
          const por = new Map(c.porSistema.map((s) => [s.sistema, s.conexoes]));
          expect(por.get('spdata-simulado') ?? 0).toBeGreaterThanOrEqual(1);
          expect(por.get('novo') ?? 0).toBeGreaterThanOrEqual(1);
          console.log(
            `[M37] MON$ na cópia: ${c.porSistema.map((s) => `${s.sistema} ${s.conexoes}`).join(', ')}`,
          );
        }),
      );
    } finally {
      await outro.encerrar();
      await novo.encerrar();
    }
  }, 120_000);

  it('gravações SGH_ do marco: setor e composição, trilha versionada, conclusão (ninguém a si) e chamado', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await gravarSetorCoex(
        e,
        a.cod,
        {
          codigo: 'agendamento',
          nome: 'Agendamento',
          onda: 1,
          situacao: 'homologacao',
          chaveLiberacao: null,
          conducao: false,
          aceiteCoordenador: false,
          colunaData: 'homologacao',
          composicao: [{ tipo: 'grupo', valor: 'ATENDIMENTO' }],
        },
        'SGH.M37',
      );
      await gravarSetorCoex(
        e,
        a.cod,
        {
          codigo: 'agendamento',
          nome: 'Agendamento',
          onda: 1,
          situacao: 'treinamento',
          chaveLiberacao: null,
          conducao: true,
          aceiteCoordenador: false,
          colunaData: 'treinamento',
          composicao: [{ tipo: 'grupo', valor: 'AGENDA' }],
        },
        'SGH.M37',
      );
      const s = (await lerSetoresCoex(e, a.cod)).find((x) => x.codigo === 'agendamento')!;
      expect(s).toMatchObject({
        situacao: 'treinamento',
        conducao: true,
        composicao: [{ tipo: 'grupo', valor: 'AGENDA' }],
      });
      expect(s.datas.homologacao).not.toBeNull();
      const t = {
        papel: 'recepcao',
        onda: 1,
        nome: 'Recepção — onda 1',
        carga: '6 h',
        tarefas: ['buscar-paciente'],
        exercicio: 'Exercício sintético da turma',
      };
      expect(await publicarTrilhaCoex(e, a.cod, t, 'SGH.M37')).toEqual({ versao: 1 });
      expect(await publicarTrilhaCoex(e, a.cod, t, 'SGH.M37')).toEqual({ versao: 2 });
      const tr = (await lerTrilhasCoex(e, a.cod)).filter((x) => x.papel === 'recepcao' && x.onda === 1);
      expect(tr.map((x) => [x.versao, x.situacao])).toEqual([
        [1, 'desatualizada'],
        [2, 'vigente'],
      ]);
      await registrarConclusoesTreino(
        e,
        a.cod,
        {
          pessoas: [{ id: 1, login: 'SGH.M37.T1' }],
          papel: 'recepcao',
          onda: 1,
          versao: 2,
          turma: 'T1',
          concluidoEm: '2026-11-04',
          resultado: 'aprovado',
        },
        'SGH.M37',
      );
      expect((await lerConclusoesTreino(e, a.cod)).some((x) => x.login === 'SGH.M37.T1')).toBe(true);
      // M43, regra 6 (script 0432): o turno da turma é gravado e relido; fora do domínio, o CHECK recusa.
      const turma = {
        pessoas: [{ id: 3, login: 'SGH.M43.T1' }],
        papel: 'recepcao',
        onda: 1,
        versao: 2,
        turma: 'T-NOITE',
        concluidoEm: '2026-11-05',
        resultado: 'aprovado' as const,
      };
      await registrarConclusoesTreino(e, a.cod, { ...turma, turno: 'noite' }, 'SGH.M37');
      const lidas = await lerConclusoesTreino(e, a.cod);
      expect(lidas.find((x) => x.login === 'SGH.M43.T1')?.turno).toBe('noite');
      expect(lidas.find((x) => x.login === 'SGH.M37.T1')?.turno).toBeNull();
      await expect(
        registrarConclusoesTreino(e, a.cod, { ...turma, turno: 'madrugada' }, 'SGH.M37'),
      ).rejects.toThrow();
      // Ninguém registra a própria conclusão (CHECK no banco).
      await expect(
        registrarConclusoesTreino(
          e,
          a.cod,
          {
            pessoas: [{ id: 2, login: 'SGH.M37' }],
            papel: 'recepcao',
            onda: 1,
            versao: 2,
            turma: 'T1',
            concluidoEm: '2026-11-04',
            resultado: 'aprovado',
          },
          'SGH.M37',
        ),
      ).rejects.toThrow();
      const agora = await relogioDoBanco(e);
      const id = await abrirChamado(e, a.cod, {
        sistema: 'novo',
        severidade: 'S2',
        tela: '/agenda',
        versao: 'teste',
        ocorridoEm: agora,
        traceId: null,
        setor: 'agendamento',
        prazoResposta: new Date(agora.getTime() + 3_600_000),
        prazoSolucao: new Date(agora.getTime() + 8 * 3_600_000),
        dadoPessoal: false,
        descricao: 'Chamado sintético da integração do M37',
        abertoPorId: null,
        abertoPor: 'SGH.M37',
      });
      expect((await lerChamados(e, a.cod, { id }))[0]).toMatchObject({
        severidade: 'S2',
        situacao: 'aberto',
      });
    });
  }, 300_000);

  it('lote de 50 usuários: liga a chave de pessoa de todos e recolhe inteiro; o estado de antes volta', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const logins = Array.from({ length: 50 }, (_, i) => `SGH.M37.L${String(i).padStart(2, '0')}`);
      const chave = { tipo: 'recurso' as const, chave: 'agenda.consulta' };
      const antes = (await lerChavesLiberacao(e, a.cod)).filter((c) => c.chave === chave.chave);
      const r = await aplicarLoteCoexistencia(
        e,
        {
          hospital: a.cod,
          setor: 'agendamento',
          alvoTipo: 'usuarios',
          alvo: logins.join(','),
          chaves: [chave],
          incluidos: logins,
          fora: [{ login: 'SGH.M37.FORA', motivo: 'trilha não concluída' }],
          justificativa: 'lote sintético de 50 usuários (M37)',
          autorizacao: null,
          autor: 'SGH.M37',
          planejar: (_k, estado) => planejarLote(estado.chaves, 'pessoa', logins, true),
        },
        trilhaBase(a, 'lote:agendamento'),
      );
      expect(r.chaves[0]?.alteradas).toBe(50);
      const ligadas = (await lerChavesLiberacao(e, a.cod)).filter(
        (c) => c.chave === chave.chave && c.escopo === 'pessoa' && c.ligada === true,
      );
      expect(ligadas.filter((c) => logins.includes(c.valor))).toHaveLength(50);
      const [lote] = await lerLotesCoex(e, a.cod, r.id);
      expect(lote).toMatchObject({ situacao: 'aplicado', incluidos: 50, fora: 1 });
      const rec = await recolherLoteCoexistencia(
        e,
        {
          hospital: a.cod,
          id: r.id,
          justificativa: 'recolhimento sintético (M37)',
          autor: 'SGH.M37',
          chaves: lote!.chaves,
          reverter: (linhas) =>
            reverterLote(
              linhas.map((c) => ({
                escopo: c.escopo,
                valor: c.valor,
                ligada: c.ligada,
                antes: c.ligadaAntes,
              })),
            ),
        },
        trilhaBase(a, 'recolher:agendamento'),
      );
      expect(rec).toEqual({ recolhido: true, alteradas: 50 });
      const depois = (await lerChavesLiberacao(e, a.cod)).filter((c) => c.chave === chave.chave);
      // O estado de antes: nenhuma pessoa ligada a mais (as linhas criadas pelo lote herdam: LIGADA nula).
      expect(depois.filter((c) => c.ligada === true).length).toBe(
        antes.filter((c) => c.ligada === true).length,
      );
      expect((await lerLotesCoex(e, a.cod, r.id))[0]?.situacao).toBe('recolhido');
      expect(
        await recolherLoteCoexistencia(
          e,
          {
            hospital: a.cod,
            id: r.id,
            justificativa: 'de novo',
            autor: 'SGH.M37',
            chaves: lote!.chaves,
            reverter: () => [],
          },
          trilhaBase(a, 'x'),
        ),
      ).toEqual({ recolhido: false, alteradas: 0 });
    });
  }, 300_000);
});
