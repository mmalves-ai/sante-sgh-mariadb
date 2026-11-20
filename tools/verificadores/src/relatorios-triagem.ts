// pnpm relatorios:triagem [-- --hospital=<cod|todos>] [--so-ler] (ficha do M34, regra 2; script novo registrado em
// ESTADO.md › Desvios): o inventário dos relatórios de consulta livre do editor de relatórios (só metadado: nome,
// módulo, tipo, opção, parâmetros e se o acesso é restrito; o texto da consulta nunca é lido), a proposta de destino,
// papel dono, artefato e onda pelas regras versionadas (@sgh/dominio-relatorio) e a gravação em SGH_REL_TRIAGEM
// (inclui as que faltam, atualiza as propostas; a decisão confirmada pela área fica). Sai 1 com relatório sem destino
// ou sem dono. Só AMBIENTE=dev na cópia do projeto (loopback). Resumo só com contagens (nenhum nome de pessoa).
import { proporTriagem, resumirTriagem } from '@sgh/dominio-relatorio';
import { gravarPropostasTriagem, gravarTrilha, inventarioRelatoriosOrigem, resumoTriagem } from '@sgh/legado';
import { abrirNucleoCopia } from './copia-leitura.ts';

const args = process.argv.slice(2);
const pedido = args.find((a) => a.startsWith('--hospital='))?.slice(11) ?? 'todos';
const soLer = args.includes('--so-ler');
const { nucleo, codigos } = abrirNucleoCopia();
let ok = true;
try {
  const alvos = pedido === 'todos' ? codigos : codigos.filter((c) => c === pedido);
  if (pedido === 'todos' && alvos.length < 2)
    console.log(
      `Bloqueio: só ${alvos.join(', ')} configurado; os demais estabelecimentos aguardam a cópia (HS-1).`,
    );
  for (const h of alvos) {
    const ctx = { rede: nucleo.rede, hospital: h, traceId: 'relatorios-triagem' };
    const inventario = await nucleo.lerSomente(ctx, (l) => inventarioRelatoriosOrigem(l));
    const propostas = inventario.map((r) => ({ ...r, ...proporTriagem(r) }));
    const resumo = resumirTriagem(propostas);
    console.log(
      `[${h}] ${resumo.total} relatórios: ${resumo.total - resumo.semDestino} com destino, ${resumo.semDestino} sem destino, ${resumo.semDono} sem dono`,
    );
    console.log(`[${h}] por destino: ${JSON.stringify(resumo.porDestino)}`);
    console.log(`[${h}] por marco: ${JSON.stringify(resumo.porMarco)}`);
    if (resumo.semDestino > 0 || resumo.semDono > 0) ok = false;
    if (soLer) continue;
    const r = await nucleo.gravarSgh(ctx, async (e) => {
      const x = await gravarPropostasTriagem(
        e,
        h,
        propostas.map((p) => ({
          id: p.id,
          nome: p.nome,
          modulo: p.modulo,
          destino: p.destino,
          marco: p.marco,
          artefato: p.artefato,
          papelDono: p.papelDono,
          onda: p.onda,
          regra: p.regra,
          motivo: p.motivo,
        })),
      );
      await gravarTrilha(e, {
        rede: nucleo.rede,
        hospital: h,
        usuario: 'SGH.TRIAGEM',
        evento: 'relatorio.triagem.decidida',
        recurso: 'relatorio.triagem',
        operacao: 'propor',
        tabelaAlvo: 'SGH_REL_TRIAGEM',
        idAlvo: String(propostas.length),
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'relatorios:triagem',
        correlacao: 'relatorios-triagem',
      });
      return x;
    });
    const gravado = await nucleo.lerSomente(ctx, (l) => resumoTriagem(l, h));
    console.log(
      `[${h}] gravado: ${r.incluidas} incluída(s), ${r.atualizadas} atualizada(s), ${r.preservadas} decisão(ões) da área preservada(s); na tabela ${gravado.total} com ${gravado.semDono} sem dono e ${gravado.confirmadas} confirmada(s)`,
    );
    if (gravado.total !== resumo.total || gravado.semDono > 0) ok = false;
  }
} finally {
  await nucleo.encerrar();
}
console.log(ok ? 'Resultado: verde' : 'Resultado: VERMELHO');
process.exit(ok ? 0 : 1);
