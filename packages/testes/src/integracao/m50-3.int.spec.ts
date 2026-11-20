// M50, etapa 3 (correção da revisão), na cópia e sempre em transação desfeita: a secretaria do bloco confirma um pedido
// do portal do médico externo pela operação do M18 (cirurgia.agendarCirurgia pelo executor, com a solicitação) com um
// cirurgião que ainda NÃO atuou no bloco desde 2025 (fora das opções do mapa: o caso típico do médico externo) e o
// registro do novo (SGH_CC_AGENDA_ESTADO) ganha o paciente confirmado (ID_RICADPAC, PRONT), para a trilha das ações
// seguintes. Massa sintética (operador, paciente e o paciente informado); da cópia só os identificadores de um registro
// de profissional. Saída só com contagens; nada fica (retrato antes e depois igual).
import { carregarDominiosVistos, incluirEstado, operacao, profissionaisDoBloco } from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diaLivreDaSala, MARCA_CC_M18 } from '../massa/reproducao-cirurgia.js';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];
const CONTA_PEDIDO = 2_000_050_331;

describe.skipIf(!PODE_ESCREVER)(
  'pedido do portal do médico externo confirmado no bloco (transação desfeita)',
  () => {
    let a: Ambiente;
    const tiposLogradouro =
      carregarDominiosVistos(resolve(import.meta.dirname, '../../../legado/src')).vistos(
        'RICADPAC',
        'TPLGR',
      ) ?? new Set<string>();

    beforeAll(async () => {
      a = await prepararAmbiente();
    });
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => ({
        ccagenda: await contar(l, 'SELECT MAX(ID) N FROM CCAGENDA'),
        cchisage: await contar(l, 'SELECT COUNT(*) N FROM CCHISAGE'),
        estado: await contar(l, 'SELECT COUNT(*) N FROM SGH_CC_AGENDA_ESTADO'),
        ricadpac: await contar(l, 'SELECT MAX(ID) N FROM RICADPAC'),
      }));

    async function operador(e: Escritor): Promise<string> {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      return login;
    }
    async function paciente(e: Escritor, usuario: string): Promise<number> {
      const cpf = await cpfLivre(e, (Date.now() + 7919) % 90_000_000);
      const cep = await cepCompleto(e, tiposLogradouro);
      const r = await a.executor.executar(
        operacao('cadastro.cadastrarPaciente'),
        a.cod,
        pacienteSintetico('com-cep', cpf, cep),
        ctxOperacao(a, usuario),
        { escritor: e },
      );
      return num(r.resultado['idPaciente']);
    }

    it('confirma com o cirurgião fora das opções do bloco e o estado ganha o paciente', async () => {
      const antes = await retrato();
      const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const usuario = await operador(e);
        const exec = (op: string, entrada: unknown) =>
          a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, usuario), { escritor: e });
        const SALA = 1;
        await exec('cirurgia.definirSalaUsuario', { sala: SALA, usuario, acao: 'incluir' });
        // Um registro ativo, com código, que não aparece na agenda do bloco desde 2025 (só identificadores).
        const [fora] = await e.consultar(
          `SELECT FIRST 1 c.ID, c.COD FROM TBCBOPRO c
          WHERE c.COD > 0 AND COALESCE(c.ATIVO, 'T') <> 'F' AND c.ID NOT IN (1, 488) AND c.ID_TBPROFIS IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM CCAGENDA x WHERE x.ID_CRM = c.ID AND x.DATA_HORA >= '2025-01-01')
          ORDER BY c.ID DESC`,
          [],
          { teto: 1 },
        );
        if (!fora) throw new Error('A cópia não tem registro fora do bloco.');
        const cir = { id: num(fora['ID']), cod: num(fora['COD']) };
        const doBloco = (await profissionaisDoBloco(e)).some((p) => p.id === cir.id);
        const dia = await diaLivreDaSala(e, SALA);
        const pac = await paciente(e, usuario);
        // O pedido do portal: sem cadastro (REG e PRONT 0, ID_RICADPAC nulo), com a conta e o paciente informado.
        const id = await incluirEstado(e, {
          hospital: a.cod,
          idCcagenda: null,
          sala: SALA,
          data: dia,
          hora: '0700',
          duracaoMin: 60,
          intervaloMin: 0,
          reg: 0,
          pront: 0,
          idPaciente: null,
          procedimento: 30_101_271,
          convenio: 306,
          cirurgiao: cir.id,
          carater: 2,
          anestesia: 1,
          estado: 'solicitado',
          observacao: `${MARCA_CC_M18}: pedido do portal M50.3`,
          usuario: `SGH.PORTAL.M${CONTA_PEDIDO}`,
          portal: {
            acesso: CONTA_PEDIDO,
            paciente: 'PACIENTE INFORMADO SINTETICO M503',
            nascimento: '1970-05-02',
          },
        });
        const conf = await exec('cirurgia.agendarCirurgia', {
          sala: SALA,
          data: dia,
          hora: '0700',
          duracaoMin: 60,
          intervaloMin: 0,
          paciente: pac,
          reg: 0,
          atendimento: 'I',
          especialidade: 33,
          convenio: 306,
          procedimento: 30_101_271,
          anestesia: 1,
          equipe: { cirurgiao: cir },
          pediatra: null,
          recursos: [],
          procedimentosAdicionais: [],
          carater: 2,
          solicitacao: id,
          excecao: null,
          observacao: `${MARCA_CC_M18}: confirmação M50.3`,
        });
        const agendamento = num(conf.resultado['agendamento']);
        const [linha] = await e.consultar(
          `SELECT ESTADO, ID_CCAGENDA, ID_RICADPAC, PRONT, ID_CIRURGIAO, ID_PORTAL_ACESSO FROM SGH_CC_AGENDA_ESTADO
          WHERE HOSPITAL = ? AND ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
          [a.cod, String(id)],
          { teto: 1 },
        );
        const [ag] = await e.consultar('SELECT ID_CRM, PRONT FROM CCAGENDA WHERE ID = ?', [agendamento], {
          teto: 1,
        });
        return {
          doBloco,
          estado: String(linha?.['ESTADO']).trim(),
          ligado: num(linha?.['ID_CCAGENDA']) === agendamento,
          comPaciente: num(linha?.['ID_RICADPAC']) === pac,
          prontuarioIgual: num(linha?.['PRONT']) > 0 && num(linha?.['PRONT']) === num(ag?.['PRONT']),
          cirurgiaoNaAgenda: num(ag?.['ID_CRM']) === cir.id && num(linha?.['ID_CIRURGIAO']) === cir.id,
          conta: num(linha?.['ID_PORTAL_ACESSO']) === CONTA_PEDIDO,
        };
      });
      expect(r).toEqual({
        doBloco: false,
        estado: 'confirmado',
        ligado: true,
        comPaciente: true,
        prontuarioIgual: true,
        cirurgiaoNaAgenda: true,
        conta: true,
      });
      expect(await retrato()).toEqual(antes);
      console.log(`[${a.cod}] m50.3 confirmação do pedido do portal: ${JSON.stringify(r)}`);
    });
  },
);
