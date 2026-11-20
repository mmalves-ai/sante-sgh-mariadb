<script setup lang="ts">
// Ficha do lote de contas médicas (M56, etapa 6, F5; leitura na trilha: guias e procedimentos por beneficiário): os
// dados do lote e do arquivo, os valores (apresentado, glosado, acatado no recurso, liberado, pago, a pagar), cada guia
// com o beneficiário, a senha e a autorização, as críticas do recebimento, os itens com a glosa (o motivo da tabela 38, a
// origem automática ou do auditor, a justificativa) e o recurso; o histórico. As ações vêm do servidor (situação e quem
// está na tela): glosar e desfazer cada item, concluir a análise, devolver, baixar o demonstrativo, registrar e decidir o
// recurso de glosa. W0-10 (M8): o recurso por item enviado pelo prestador no portal aparece item a item e é decidido
// item a item (valor acatado até o recorrido e parecer de cada item), no lugar da decisão pela guia.
import type {
  ApoioContas,
  ContaMedicaDetalhe,
  GuiaConta,
  ItemContaMedica,
  ResultadoConta,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../../casca/erros/problem-details.js';
import {
  baixarDemonstrativo,
  concluirAnalise,
  decidirRecurso,
  decidirRecursoItens,
  devolverConta,
  glosarConta,
  lerConta,
  lerDemonstrativo,
  lerDemonstrativoPagamento,
  registrarRecurso,
} from '../../api-contas.js';
import { dataBr, numeroDe } from '../f1/comum.js';

const props = defineProps<{ id: number; apoio: ApoioContas }>();
const emit = defineEmits<{ gravado: [r: ResultadoConta]; fechar: [] }>();
const { t } = useI18n();

const ficha = useQuery({
  queryKey: computed(() => ['operadora', 'contas', 'ficha', props.id]),
  queryFn: () => lerConta(props.id),
});
const c = computed(() => ficha.data.value ?? null);
const tem = (a: ContaMedicaDetalhe['acoes'][number]) => c.value?.acoes.includes(a) === true;
const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quando = (d: string | null) => (d ? `${dataBr(d.slice(0, 10))} ${d.slice(11, 16)}` : '—');
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const motivosOpcoes = computed(() =>
  props.apoio.motivos.map((m) => ({ valor: m.codigo as number | null, rotulo: `${m.codigo} · ${m.rotulo}` })),
);
const despesa = (i: ItemContaMedica) =>
  i.grupo === 'despesa'
    ? t('operadoraContas.itens.despesa', {
        tipo: i.codigoDespesa ? t(`operadoraContas.despesas.${i.codigoDespesa}`) : '—',
      })
    : t('operadoraContas.itens.procedimento');

// ── Diálogos (um por vez) ────────────────────────────────────────────────────────────────────────
type Dialogo = 'glosa' | 'concluir' | 'devolver' | 'recurso' | 'decidir' | 'decidir-itens';
const dialogo = ref<Dialogo | null>(null);
const visivel = computed({
  get: () => dialogo.value !== null,
  set: (v: boolean) => {
    if (!v) dialogo.value = null;
  },
});
const guiaAlvo = ref<GuiaConta | null>(null);
const itemAlvo = ref<ItemContaMedica | null>(null);
const valor = ref('');
const motivo = ref<number | null>(null);
const texto = ref('');
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const enviando = ref(false);
const baixando = ref(false);
/** W0-10 (M8): valor acatado e parecer de cada item recorrido (chave: id do recurso do item). */
const decisoesItens = ref<Record<number, { valor: string; parecer: string }>>({});
const pendentesItens = (g: GuiaConta | null) => (g ? g.recursosItens.filter((r) => r.decisao === null) : []);
const itemDaGuia = (g: GuiaConta, item: number) => g.itens.find((i) => i.id === item) ?? null;
const rotuloItem = (g: GuiaConta, item: number) => {
  const i = itemDaGuia(g, item);
  return i ? `${i.sequencial} · ${i.codigo}` : String(item);
};
const erroDemonstrativo = ref<string | null>(null);

function abrir(d: Dialogo, g: GuiaConta | null = null, i: ItemContaMedica | null = null): void {
  dialogo.value = d;
  guiaAlvo.value = g;
  itemAlvo.value = i;
  recusa.value = null;
  erro.value = null;
  texto.value = '';
  motivo.value = null;
  valor.value = '';
  if (d === 'glosa' && i) {
    valor.value =
      i.glosado > 0 ? String(i.glosado).replace('.', ',') : String(i.apresentado).replace('.', ',');
    motivo.value = i.motivo;
    texto.value = i.origem === 'auditor' ? (i.justificativa ?? '') : '';
  }
  if (d === 'recurso' && g) valor.value = String(g.glosado - g.acatado).replace('.', ',');
  if (d === 'decidir' && g?.recurso) valor.value = String(g.recurso.valor).replace('.', ',');
  if (d === 'decidir-itens')
    decisoesItens.value = Object.fromEntries(
      pendentesItens(g).map((r) => [r.id, { valor: String(r.valor).replace('.', ','), parecer: '' }]),
    );
}

const titulo = computed(() => {
  const k = c.value;
  if (!k) return '';
  if (dialogo.value === 'glosa')
    return t('operadoraContas.glosa.titulo', {
      seq: itemAlvo.value?.sequencial ?? '',
      guia: guiaAlvo.value?.numeroGuiaPrestador ?? '',
    });
  if (dialogo.value === 'concluir') return t('operadoraContas.analise.titulo', { protocolo: k.protocolo });
  if (dialogo.value === 'devolver') return t('operadoraContas.devolucao.titulo', { protocolo: k.protocolo });
  if (dialogo.value === 'recurso')
    return t('operadoraContas.recurso.titulo', { guia: guiaAlvo.value?.numeroGuiaPrestador ?? '' });
  if (dialogo.value === 'decidir-itens')
    return t('operadoraContas.recurso.decidirItensTitulo', {
      guia: guiaAlvo.value?.numeroGuiaPrestador ?? '',
    });
  return t('operadoraContas.recurso.decidirTitulo', { guia: guiaAlvo.value?.numeroGuiaPrestador ?? '' });
});

const completo = computed(() => {
  const v = numeroDe(valor.value);
  if (dialogo.value === 'glosa')
    return v !== null && v >= 0 && (v === 0 || (motivo.value !== null && texto.value.trim().length >= 5));
  if (dialogo.value === 'concluir') return true;
  if (dialogo.value === 'devolver') return texto.value.trim().length >= 10;
  if (dialogo.value === 'recurso') return v !== null && v > 0 && texto.value.trim().length >= 10;
  if (dialogo.value === 'decidir-itens') {
    const ps = pendentesItens(guiaAlvo.value);
    return (
      ps.length > 0 &&
      texto.value.trim().length >= 10 &&
      ps.every((r) => {
        const d = decisoesItens.value[r.id];
        const a = d ? numeroDe(d.valor) : null;
        return d !== undefined && a !== null && a >= 0 && a <= r.valor && d.parecer.trim().length >= 10;
      })
    );
  }
  return v !== null && v >= 0 && texto.value.trim().length >= 10;
});

async function confirmar(desfazer = false): Promise<void> {
  const k = c.value;
  if (!k || (!desfazer && !completo.value)) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  const v = numeroDe(valor.value) ?? 0;
  try {
    const versao = { versao: k.versao };
    const r =
      dialogo.value === 'glosa'
        ? await glosarConta(k.id, {
            ...versao,
            itens: [
              desfazer || v === 0
                ? { item: itemAlvo.value!.id, valorGlosado: 0, motivo: null, justificativa: null }
                : {
                    item: itemAlvo.value!.id,
                    valorGlosado: v,
                    motivo: motivo.value,
                    justificativa: texto.value,
                  },
            ],
          })
        : dialogo.value === 'concluir'
          ? await concluirAnalise(k.id, { ...versao, observacao: texto.value.trim() || null })
          : dialogo.value === 'devolver'
            ? await devolverConta(k.id, { ...versao, motivo: texto.value })
            : dialogo.value === 'decidir-itens'
              ? await decidirRecursoItens(k.id, guiaAlvo.value!.id, {
                  ...versao,
                  decisoes: pendentesItens(guiaAlvo.value).map((r) => ({
                    item: r.item,
                    valorAcatado: numeroDe(decisoesItens.value[r.id]!.valor) ?? 0,
                    parecer: decisoesItens.value[r.id]!.parecer.trim(),
                  })),
                  parecer: texto.value.trim(),
                })
              : dialogo.value === 'recurso'
                ? await registrarRecurso(k.id, {
                    ...versao,
                    guia: guiaAlvo.value!.id,
                    valor: v,
                    justificativa: texto.value,
                  })
                : await decidirRecurso(k.id, {
                    ...versao,
                    guia: guiaAlvo.value!.id,
                    valorAcatado: v,
                    parecer: texto.value,
                  });
    dialogo.value = null;
    emit('gravado', r);
    await ficha.refetch();
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    enviando.value = false;
  }
}

async function demonstrativo(tipo: 'analise' | 'pagamento' = 'analise'): Promise<void> {
  erroDemonstrativo.value = null;
  baixando.value = true;
  try {
    baixarDemonstrativo(
      await (tipo === 'pagamento' ? lerDemonstrativoPagamento(props.id) : lerDemonstrativo(props.id)),
    );
  } catch (e) {
    erroDemonstrativo.value = e instanceof ErroApi && e.problema?.detail ? e.problema.detail : String(e);
  } finally {
    baixando.value = false;
  }
}
const recorrivel = (g: GuiaConta) => tem('recurso') && g.glosado > 0 && g.recurso === null;
const decidivelItens = (g: GuiaConta) =>
  tem('decidir-recurso') && g.recurso?.situacao === 'pendente' && pendentesItens(g).length > 0;
const decidivel = (g: GuiaConta) =>
  tem('decidir-recurso') && g.recurso?.situacao === 'pendente' && !decidivelItens(g);
</script>

<template>
  <section class="bloco" aria-labelledby="conta-ficha-titulo" data-testid="conta-ficha">
    <div class="acoes cabeca">
      <h2 id="conta-ficha-titulo">{{ t('operadoraContas.ficha.titulo') }}</h2>
      <SanteBotao variante="texto" :rotulo="t('operadoraContas.acoes.fechar')" @acionar="emit('fechar')" />
    </div>
    <MensagemErro v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!c" role="status">{{ t('operadoraContas.carregando') }}</p>
    <template v-else>
      <h3 data-testid="conta-ficha-protocolo">{{ c.protocolo }}</h3>
      <dl class="ficha">
        <div>
          <dt>{{ t('operadoraContas.ficha.situacao') }}</dt>
          <dd data-testid="conta-ficha-situacao">{{ t(`operadoraContas.situacoes.${c.situacao}`) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.operadora') }}</dt>
          <dd>{{ c.operadoraNome }} · {{ c.registroAns }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.prestador') }}</dt>
          <dd>{{ c.prestadorNome }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.lote') }}</dt>
          <dd>{{ c.numeroLote }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.tipo') }}</dt>
          <dd>{{ t(`operadoraContas.tiposGuia.${c.tipoGuia}`) }} · {{ c.guias }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.competencia') }}</dt>
          <dd>{{ c.competencia }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.recebida') }}</dt>
          <dd>{{ quando(c.recebidaEm) }}</dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.prazo') }}</dt>
          <dd>
            {{ dataBr(c.prazoPagamento) }}
            <strong v-if="c.vencida"> · {{ t('operadoraContas.prazoVencido') }}</strong>
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.arquivo') }}</dt>
          <dd>
            {{
              t('operadoraContas.ficha.arquivoTexto', {
                nome: c.arquivo.nome ?? '—',
                kb: Math.ceil(c.arquivo.bytes / 1000),
                versao: c.arquivo.versaoTiss,
              })
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t('operadoraContas.ficha.hash') }}</dt>
          <dd class="codigo">{{ c.arquivo.hashEpilogo }}</dd>
        </div>
        <div v-if="c.analisadaEm">
          <dt>{{ t('operadoraContas.ficha.analise') }}</dt>
          <dd>
            {{
              t('operadoraContas.ficha.analiseTexto', {
                data: quando(c.analisadaEm),
                por: c.analisadaPor ?? '—',
              })
            }}
          </dd>
        </div>
        <div v-if="c.observacao">
          <dt>{{ t('operadoraContas.ficha.observacao') }}</dt>
          <dd>{{ c.observacao }}</dd>
        </div>
        <div v-if="c.motivoDevolucao">
          <dt>{{ t('operadoraContas.ficha.devolucao') }}</dt>
          <dd data-testid="conta-ficha-devolucao">{{ c.motivoDevolucao }}</dd>
        </div>
      </dl>

      <h3>{{ t('operadoraContas.ficha.valores') }}</h3>
      <dl class="totais" data-testid="conta-ficha-valores">
        <div
          v-for="k in ['apresentado', 'glosado', 'acatado', 'liberado', 'pago', 'saldo'] as const"
          :key="k"
        >
          <dt>
            {{
              k === 'acatado'
                ? t('operadoraContas.recurso.situacoes.acatado')
                : t(`operadoraContas.colunas.${k}`)
            }}
          </dt>
          <dd :data-testid="`conta-valor-${k}`">{{ brl(c[k]) }}</dd>
        </div>
      </dl>

      <div class="acoes">
        <SanteBotao
          v-if="tem('concluir')"
          :rotulo="t('operadoraContas.acoes.concluir')"
          data-testid="conta-concluir"
          @acionar="abrir('concluir')"
        />
        <SanteBotao
          v-if="tem('devolver')"
          variante="secundario"
          :rotulo="t('operadoraContas.acoes.devolver')"
          data-testid="conta-devolver"
          @acionar="abrir('devolver')"
        />
        <SanteBotao
          v-if="c.situacao === 'analisada' || c.situacao === 'paga'"
          variante="secundario"
          :rotulo="t('operadoraContas.acoes.demonstrativo')"
          :desabilitado="baixando"
          data-testid="conta-demonstrativo"
          @acionar="demonstrativo()"
        />
        <SanteBotao
          v-if="c.situacao === 'paga'"
          variante="secundario"
          :rotulo="t('operadoraContas.acoes.demonstrativoPagamento')"
          :desabilitado="baixando"
          data-testid="conta-demonstrativo-pagamento"
          @acionar="demonstrativo('pagamento')"
        />
      </div>
      <SanteAlerta v-if="erroDemonstrativo" :texto="erroDemonstrativo" variante="alerta" />

      <h3>{{ t('operadoraContas.ficha.guias') }}</h3>
      <section
        v-for="g in c.guiasDetalhe"
        :key="g.id"
        class="guia"
        :aria-labelledby="`conta-guia-${g.id}`"
        :data-testid="`conta-guia-${g.ordem}`"
      >
        <h4 :id="`conta-guia-${g.id}`">
          {{ t('operadoraContas.ficha.guia', { numero: g.numeroGuiaPrestador }) }}
        </h4>
        <dl class="ficha">
          <div>
            <dt>{{ t('operadoraContas.ficha.beneficiario') }}</dt>
            <dd>{{ g.beneficiario?.nome ?? t('operadoraContas.ficha.semBeneficiario') }}</dd>
          </div>
          <div>
            <dt>{{ t('operadoraContas.ficha.carteirinha') }}</dt>
            <dd>{{ g.carteirinha }}</dd>
          </div>
          <div>
            <dt>{{ t('operadoraContas.ficha.senha') }}</dt>
            <dd>{{ g.senha ?? t('operadoraContas.ficha.semSenha') }}</dd>
          </div>
          <div v-if="g.autorizacao">
            <dt>{{ t('operadoraContas.ficha.autorizacao') }}</dt>
            <dd>{{ g.autorizacao.protocolo }}</dd>
          </div>
          <div>
            <dt>{{ t('operadoraContas.ficha.atendimento') }}</dt>
            <dd>
              {{
                g.fim !== g.inicio
                  ? t('operadoraContas.ficha.periodo', { de: dataBr(g.inicio), ate: dataBr(g.fim) })
                  : dataBr(g.inicio)
              }}
            </dd>
          </div>
        </dl>
        <p class="secundario" :data-testid="`conta-guia-${g.ordem}-total`">
          {{
            t('operadoraContas.ficha.totalGuia', {
              apresentado: brl(g.apresentado),
              glosado: brl(g.glosado),
              acatado: brl(g.acatado),
            })
          }}
        </p>
        <div :data-testid="`conta-guia-${g.ordem}-criticas`">
          <p class="rotulo">{{ t('operadoraContas.ficha.criticas') }}</p>
          <ul v-if="g.criticas.length">
            <li v-for="k in g.criticas" :key="k.codigo">{{ k.texto }} ({{ k.motivo }})</li>
          </ul>
          <p v-else class="secundario">{{ t('operadoraContas.ficha.semCriticas') }}</p>
        </div>
        <p v-if="g.recurso" :data-testid="`conta-guia-${g.ordem}-recurso`">
          {{
            t('operadoraContas.recurso.resumo', {
              situacao: t(`operadoraContas.recurso.situacoes.${g.recurso.situacao}`),
              valor: brl(g.recurso.valor),
            })
          }}<template v-if="g.recurso.valorAcatado !== null">
            ·
            {{ t('operadoraContas.recurso.acatadoTexto', { valor: brl(g.recurso.valorAcatado) }) }}</template
          >
          <template v-if="g.recurso.parecer"> · {{ g.recurso.parecer }}</template>
        </p>
        <div v-if="g.recursosItens.length" :data-testid="`conta-guia-${g.ordem}-recurso-itens`">
          <p class="rotulo">{{ t('operadoraContas.recurso.itens') }}</p>
          <ul>
            <li v-for="r in g.recursosItens" :key="r.id" :data-testid="`conta-recurso-item-${r.item}`">
              {{
                t('operadoraContas.recurso.item', {
                  item: rotuloItem(g, r.item),
                  valor: brl(r.valor),
                  justificativa: r.justificativa,
                })
              }}
              ·
              <span class="secundario">{{
                r.decisao
                  ? t('operadoraContas.recurso.itemDecidido', {
                      valor: brl(r.decisao.valorAcatado),
                      parecer: r.decisao.parecer,
                    })
                  : t('operadoraContas.recurso.itemPendente')
              }}</span>
            </li>
          </ul>
        </div>
        <div class="acoes">
          <SanteBotao
            v-if="recorrivel(g)"
            variante="secundario"
            :rotulo="t('operadoraContas.acoes.recurso')"
            :data-testid="`conta-guia-${g.ordem}-recorrer`"
            @acionar="abrir('recurso', g)"
          />
          <SanteBotao
            v-if="decidivel(g)"
            :rotulo="t('operadoraContas.acoes.decidirRecurso')"
            :data-testid="`conta-guia-${g.ordem}-decidir`"
            @acionar="abrir('decidir', g)"
          />
          <SanteBotao
            v-if="decidivelItens(g)"
            :rotulo="t('operadoraContas.recurso.decidirItens')"
            :data-testid="`conta-guia-${g.ordem}-decidir-itens`"
            @acionar="abrir('decidir-itens', g)"
          />
        </div>
        <table class="tabela" :data-testid="`conta-guia-${g.ordem}-itens`">
          <caption class="visualmente-oculto">
            {{
              t('operadoraContas.ficha.itens')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('operadoraContas.itens.sequencial') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.codigo') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.descricao') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.quantidade') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.unitario') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.apresentado') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.glosado') }}</th>
              <th scope="col">{{ t('operadoraContas.itens.motivo') }}</th>
              <th scope="col">
                <span class="visualmente-oculto">{{ t('operadoraContas.colunas.acoes') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in g.itens"
              :key="i.id"
              :data-testid="`conta-item-${g.ordem}-${i.sequencial}-${i.grupo}`"
            >
              <td>{{ i.sequencial }}</td>
              <td>{{ i.tabela }} · {{ i.codigo }}</td>
              <td>
                {{ i.descricao }}
                <span class="secundario"> · {{ despesa(i) }} · {{ dataBr(i.data) }}</span>
              </td>
              <td>{{ qtd(i.quantidade) }}</td>
              <td>{{ brl(i.valorUnitario) }}</td>
              <td>{{ brl(i.apresentado) }}</td>
              <td :data-testid="`conta-item-${g.ordem}-${i.sequencial}-${i.grupo}-glosado`">
                {{ brl(i.glosado) }}
              </td>
              <td>
                <template v-if="i.motivo !== null">
                  {{ i.motivo }} · {{ i.motivoNome }}
                  <span class="secundario">
                    ({{ t(`operadoraContas.itens.origem.${i.origem ?? 'auditor'}`) }})</span
                  >
                  <br /><span class="secundario">{{ i.justificativa }}</span>
                </template>
                <template v-else>—</template>
              </td>
              <td>
                <SanteBotao
                  v-if="tem('glosar')"
                  variante="texto"
                  :rotulo="t('operadoraContas.acoes.glosarItem', { seq: i.sequencial })"
                  :data-testid="`conta-glosar-${g.ordem}-${i.sequencial}-${i.grupo}`"
                  @acionar="abrir('glosa', g, i)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <h3>{{ t('operadoraContas.ficha.historico') }}</h3>
      <ol class="historico" data-testid="conta-historico">
        <li v-for="e in c.eventos" :key="e.id" :data-evento="e.evento">
          <strong>{{ t(`operadoraContas.eventos.${e.evento}`) }}</strong> · {{ quando(e.em) }} · {{ e.por }}
          <template v-if="e.valor !== null"> · {{ brl(e.valor) }}</template>
          <template v-if="e.documento"> · {{ e.documento }}</template>
          <template v-if="e.texto"> · {{ e.texto }}</template>
        </li>
      </ol>
    </template>

    <SanteDialogo v-model:visivel="visivel" :titulo="titulo" largura="44rem">
      <div v-if="c" class="formulario" data-testid="form-dialogo-conta">
        <template v-if="dialogo === 'glosa' && itemAlvo">
          <p class="secundario">
            {{ t('operadoraContas.glosa.texto', { apresentado: brl(itemAlvo.apresentado) }) }}
          </p>
          <SanteCampoTexto
            id="conta-glosa-valor"
            v-model="valor"
            :rotulo="t('operadoraContas.glosa.valor')"
            :max-bytes="16"
            obrigatorio
          />
          <SanteSelecao
            v-model="motivo"
            :rotulo="t('operadoraContas.glosa.motivo')"
            :opcoes="motivosOpcoes"
            :busca="true"
            data-testid="conta-glosa-motivo"
          />
          <SanteCampoTexto
            id="conta-glosa-justificativa"
            v-model="texto"
            :rotulo="t('operadoraContas.glosa.justificativa')"
            :max-bytes="500"
            multilinha
          />
        </template>
        <template v-else-if="dialogo === 'concluir'">
          <p class="secundario" data-testid="conta-concluir-texto">
            {{
              t('operadoraContas.analise.texto', {
                apresentado: brl(c.apresentado),
                glosado: brl(c.glosado),
                liberado: brl(c.liberado),
              })
            }}
          </p>
          <SanteCampoTexto
            id="conta-observacao"
            v-model="texto"
            :rotulo="t('operadoraContas.analise.observacao')"
            :max-bytes="500"
            multilinha
          />
        </template>
        <template v-else-if="dialogo === 'devolver'">
          <p class="secundario">{{ t('operadoraContas.devolucao.texto') }}</p>
          <SanteCampoTexto
            id="conta-devolucao-motivo"
            v-model="texto"
            :rotulo="t('operadoraContas.devolucao.motivo')"
            :max-bytes="500"
            multilinha
            obrigatorio
          />
        </template>
        <template v-else-if="dialogo === 'recurso' && guiaAlvo">
          <p class="secundario">
            {{ t('operadoraContas.recurso.texto', { glosado: brl(guiaAlvo.glosado) }) }}
          </p>
          <SanteCampoTexto
            id="conta-recurso-valor"
            v-model="valor"
            :rotulo="t('operadoraContas.recurso.valor')"
            :max-bytes="16"
            obrigatorio
          />
          <SanteCampoTexto
            id="conta-recurso-justificativa"
            v-model="texto"
            :rotulo="t('operadoraContas.recurso.justificativa')"
            :max-bytes="1000"
            multilinha
            obrigatorio
          />
        </template>
        <template v-else-if="dialogo === 'decidir' && guiaAlvo?.recurso">
          <p class="secundario">
            {{
              t('operadoraContas.recurso.decidirTexto', {
                valor: brl(guiaAlvo.recurso.valor),
                justificativa: guiaAlvo.recurso.justificativa,
              })
            }}
          </p>
          <SanteCampoTexto
            id="conta-acatado"
            v-model="valor"
            :rotulo="t('operadoraContas.recurso.acatado')"
            :max-bytes="16"
            obrigatorio
          />
          <SanteCampoTexto
            id="conta-parecer"
            v-model="texto"
            :rotulo="t('operadoraContas.recurso.parecer')"
            :max-bytes="1000"
            multilinha
            obrigatorio
          />
        </template>
        <template v-else-if="dialogo === 'decidir-itens' && guiaAlvo">
          <p class="secundario">
            {{
              t('operadoraContas.recurso.decidirItensTexto', {
                itens: pendentesItens(guiaAlvo).length,
                total: brl(pendentesItens(guiaAlvo).reduce((s, r) => s + r.valor, 0)),
              })
            }}
          </p>
          <p v-if="guiaAlvo.recurso" class="secundario">
            {{
              t('operadoraContas.recurso.justificativaGuia', {
                justificativa: guiaAlvo.recurso.justificativa,
              })
            }}
          </p>
          <fieldset
            v-for="r in pendentesItens(guiaAlvo)"
            :key="r.id"
            class="item-recurso"
            :data-testid="`conta-decidir-item-${r.item}`"
          >
            <legend>
              {{
                t('operadoraContas.recurso.item', {
                  item: rotuloItem(guiaAlvo, r.item),
                  valor: brl(r.valor),
                  justificativa: r.justificativa,
                })
              }}
            </legend>
            <template v-if="decisoesItens[r.id]">
              <SanteCampoTexto
                :id="`conta-acatado-item-${r.item}`"
                v-model="decisoesItens[r.id]!.valor"
                :rotulo="
                  t('operadoraContas.recurso.acatadoItem', {
                    item: rotuloItem(guiaAlvo, r.item),
                    valor: brl(r.valor),
                  })
                "
                :max-bytes="16"
                obrigatorio
              />
              <SanteCampoTexto
                :id="`conta-parecer-item-${r.item}`"
                v-model="decisoesItens[r.id]!.parecer"
                :rotulo="t('operadoraContas.recurso.parecerItem', { item: rotuloItem(guiaAlvo, r.item) })"
                :max-bytes="1000"
                multilinha
                obrigatorio
              />
            </template>
          </fieldset>
          <SanteCampoTexto
            id="conta-parecer-itens"
            v-model="texto"
            :rotulo="t('operadoraContas.recurso.parecerGeral')"
            :max-bytes="1000"
            multilinha
            obrigatorio
          />
        </template>
        <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="conta-dialogo-recusa" />
        <MensagemErro v-if="erro" :erro="erro" />
      </div>
      <template #rodape>
        <SanteBotao
          variante="secundario"
          :rotulo="t('operadoraContas.acoes.voltar')"
          @acionar="dialogo = null"
        />
        <SanteBotao
          v-if="dialogo === 'glosa' && itemAlvo && itemAlvo.glosado > 0"
          variante="secundario"
          :rotulo="t('operadoraContas.glosa.desfazer')"
          :desabilitado="enviando"
          data-testid="conta-glosa-desfazer"
          @acionar="confirmar(true)"
        />
        <SanteBotao
          v-if="dialogo === 'devolver'"
          variante="destrutivo"
          :confirmacao="t('operadoraContas.acoes.confirmarDevolver')"
          :rotulo="t('operadoraContas.acoes.devolver')"
          :desabilitado="!completo || enviando"
          data-testid="conta-dialogo-confirmar"
          @acionar="confirmar()"
        />
        <SanteBotao
          v-else-if="dialogo === 'concluir'"
          :rotulo="t('operadoraContas.acoes.concluir')"
          :desabilitado="enviando"
          data-testid="conta-dialogo-confirmar"
          @acionar="confirmar()"
        />
        <SanteBotao
          v-else
          :rotulo="t('operadoraContas.acoes.gravar')"
          :desabilitado="!completo || enviando"
          data-testid="conta-dialogo-confirmar"
          @acionar="confirmar()"
        />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.cabeca {
  justify-content: space-between;
}
.ficha,
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.ficha div,
.totais div {
  display: grid;
  gap: 0.125rem;
}
.ficha dt,
.totais dt,
.rotulo {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
  margin: 0;
}
.ficha dd,
.totais dd {
  margin: 0;
}
.totais dd {
  font-size: 1.2rem;
}
.item-recurso {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
.guia {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
h3,
h4 {
  margin: 0;
}
.codigo {
  font-family: monospace;
  overflow-wrap: anywhere;
}
.formulario {
  display: grid;
  gap: 0.75rem;
}
.historico {
  margin: 0;
  padding-left: 1.25rem;
}
</style>
