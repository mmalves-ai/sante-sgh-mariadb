// Integração da assinatura ICP dos documentos emitidos, etapa 2, na cópia (ficha do M49, seção 10: "integração com
// simulador de PSC e de ACT: OAuth, lote, falha, reprocessamento"; regra 5: `reprocessamento.int-spec`), sempre em
// transação DESFEITA, sobre a porta do legado numa transação aberta (os scripts 0490 a 0497):
//   - dois documentos do novo (sintéticos, pela gravação do M23) com a prévia exata (PDF mínimo num armazém em memória);
//   - o lote numa autorização só do provedor SIMULADO com a ACT FORA DO AR: as duas assinaturas ficam PENDENTES, com a
//     próxima tentativa e os avisos ao autor e à direção técnica, e nenhum evento "assinado";
//   - a ACT volta e o AGENDADOR (sessão sem pessoa) reprocessa as vencidas: assinadas, com o evento "assinado" ICP na
//     cadeia do documento e o PDF assinado registrado; nada é assinado de novo pelo provedor;
//   - só tabelas SGH_ escritas na transação; ROLLBACK provado pelas contagens das duas etapas.
// A identidade (CPF) é SINTÉTICA (sobreposta à porta): nenhum CPF de pessoa da cópia é lido aqui.
import { CPF_SINTETICO_SESSAO } from '@sgh/dominio-documento';
import {
  contagensAssinaturaDocumentoSgh,
  contagensAssinaturaSgh,
  escritasDaTransacao,
  eventosAssinadoDoUsuario,
  gravarDocumentoSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { type ArmazemPdfIcp, ServicoAssinaturaDocumentos } from './aplicacao/documentos.js';
import { ServicoAssinaturaIcp } from './aplicacao/servico.js';
import { sessaoDoAgendador } from './assinatura-documentos.controller.js';
import { configAssinaturaDoAmbiente } from './infra/ambiente.js';
import { portaAssinaturaNaTransacao } from './porta-legado.js';
import type { PortaAssinaturaIcp } from './porta.js';

const LOGIN = 'SGH.TESTE.M492';

function pdfMinimo(texto: string): Uint8Array {
  const conteudo = `BT /F1 10 Tf 40 800 Td (${texto}) Tj ET`;
  const objs = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>',
    `<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`,
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
  ];
  let s = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n`;
  for (const o of offs) s += `${String(o).padStart(10, '0')} 00000 n\r\n`;
  s += `trailer\n<</Size ${objs.length + 1} /Root 1 0 R /ID [<AA> <AA>]>>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(s, 'latin1'));
}

describe.skipIf(!PODE_ESCREVER)(
  'reprocessamento da assinatura dos documentos na cópia (transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('lote com a ACT fora: pendentes com avisos; a ACT volta e o agendador conclui; só SGH_; ROLLBACK', async () => {
      const s: SessaoCadastro = {
        req: { headers: {}, ip: '127.0.0.1' } as unknown as RequisicaoAutorizada,
        hospital: a.cod,
        rede: a.c.rede,
        login: LOGIN,
        porta: a.c,
        pode: () => false,
      };
      const cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
      const sim = cfg.simulador!;
      const volta = (endereco: string) => {
        const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
        const v = new URL(sim.autorizar(q, CPF_SINTETICO_SESSAO), 'http://x').searchParams;
        return { state: v.get('state')!, code: v.get('code'), erro: v.get('error') };
      };
      const objetos = new Map<string, Uint8Array>();
      let n = 0;
      const armazem: ArmazemPdfIcp = {
        async emitirPrevia(p) {
          const chave = `${p.rede}/${p.estabelecimento}/documentos/${p.modelo}/${++n}/via-1.pdf`;
          const pdf = pdfMinimo(`Documento SINTETICO ${p.documento} ${p.qr.identificador}`);
          objetos.set(chave, pdf);
          return { chave, versao: 'v1', pdf };
        },
        async ler(chave) {
          return objetos.get(chave)!;
        },
        async gravarAssinado(_r, _e, assinatura, pdf) {
          objetos.set(`assinado/${assinatura}`, pdf);
          return { chave: `assinado/${assinatura}`, versao: 'v1' };
        },
      };
      const contar = async () => ({
        etapa1: await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m492-c' }, (l) =>
          contagensAssinaturaSgh(l, a.cod, LOGIN, 'simulador'),
        ),
        etapa2: await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m492-c' }, (l) =>
          contagensAssinaturaDocumentoSgh(l, a.cod, LOGIN),
        ),
      });
      const antes = await contar();
      const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m492' }, async (e) => {
        const base = portaAssinaturaNaTransacao(e);
        const porta: PortaAssinaturaIcp = {
          ...base,
          identidade: async () => ({ cpf: CPF_SINTETICO_SESSAO, cpfProfissional: null, registros: [] }),
        };
        const icp = new ServicoAssinaturaIcp(porta, new RegistradorTrilhaMemoria(), cfg);
        const fonte = {
          conteudo: async () => ({
            modelo: 'atestado' as const,
            titulo: 'Atestado médico',
            profissional: 'Profissional Sintético',
            conteudo: {
              modelo: 'atestado' as const,
              identificacao: {
                paciente: 'Paciente Sintético',
                prontuario: '1',
                nascimento: null,
                atendimento: null,
                profissional: 'Profissional Sintético',
                conselho: null,
                dataHora: '24/10/2026 09:00',
              },
              corpo: ['Atesto SINTETICO.'],
            },
          }),
          nomes: async (_c: unknown, ps: readonly number[]) => new Map(ps.map((p) => [p, 'Paciente'])),
        };
        const servico = new ServicoAssinaturaDocumentos(
          icp,
          porta,
          fonte,
          armazem,
          { consultar: async () => ({ ligada: true, motivo: null }) },
          { urlVerificador: 'https://portal-teste.exemplo.invalid' },
        );
        // Os documentos do novo como o M23 grava (paciente sintético: a tabela não tem FK para o legado).
        const docs: number[] = [];
        for (const k of [1, 2])
          docs.push(
            await gravarDocumentoSgh(
              e,
              { hospital: a.cod, usuarioLegado: LOGIN },
              {
                tipo: 'atestado',
                origemTabela: 'PRATESTREQIMP',
                origemId: 900_000_100 + k,
                idAssinaturaDoc: null,
                paciente: 900_000_100,
                atendimento: null,
                cbo: null,
                hashConteudo: String(k).repeat(64),
              },
            ),
          );
        const vinculo = await icp.retornoPsc(
          s,
          volta((await icp.iniciarVinculoNuvem(s, 'simulador')).endereco),
        );
        const lote = await servico.prepararLote(s, { documentos: docs, certificado: vinculo.certificado! });
        sim.foraDoAr.act = true;
        const p = await servico.pedir(s, {
          documentos: lote.itens.map((x) => x.documento),
          hashes: lote.itens.map((x) => x.hash),
          certificado: vinculo.certificado!,
        });
        const pendente = await icp.retornoPsc(s, volta(p.inicio?.tipo === 'nuvem' ? p.inicio.endereco : ''));
        const fila1 = await servico.fila(s);
        const eventos1 = await eventosAssinadoDoUsuario(e, a.cod, LOGIN);
        sim.foraDoAr.act = false;
        // O agendador, "no futuro" (as próximas tentativas venceram), com a sessão sem pessoa.
        const agendador = new ServicoAssinaturaDocumentos(icp, porta, fonte, armazem, null, {
          urlVerificador: 'https://portal-teste.exemplo.invalid',
          agora: () => new Date(Date.now() + 10 * 3_600_000),
        });
        const ciclo = await agendador.cicloReprocessamento(sessaoDoAgendador(a.c.rede, a.cod));
        const fila2 = await servico.fila(s);
        const eventos2 = await eventosAssinadoDoUsuario(e, a.cod, LOGIN);
        return {
          lote,
          pendente,
          fila1,
          eventos1: eventos1.assinados,
          ciclo,
          fila2,
          eventos2: eventos2.icp,
          docs,
          escritas: await escritasDaTransacao(e),
        };
      });
      expect(r.lote.itens).toHaveLength(2);
      expect(r.pendente).toMatchObject({
        finalidade: 'documento',
        lote: { assinados: 0, pendentes: 2, recusados: 0 },
      });
      const meus1 = r.fila1.itens.filter((x) => r.docs.includes(x.documento));
      expect(meus1.map((x) => x.situacao)).toEqual(['pendente', 'pendente']);
      expect(meus1[0]).toMatchObject({ falha: 'act-indisponivel', tentativas: 1 });
      expect(r.fila1.avisos.length).toBeGreaterThanOrEqual(2);
      expect(r.eventos1).toBe(0);
      expect(r.ciclo.assinadas).toBeGreaterThanOrEqual(2);
      expect(r.fila2.itens.filter((x) => r.docs.includes(x.documento))).toHaveLength(0);
      expect(r.fila2.assinados.filter((x) => r.docs.includes(x.documento))).toHaveLength(2);
      expect(r.eventos2).toBe(2);
      expect(r.escritas.length).toBeGreaterThan(0);
      for (const w of r.escritas) expect(w.tabela).toMatch(/^SGH_/);
      expect(await contar()).toEqual(antes);
    }, 300_000);
  },
);
