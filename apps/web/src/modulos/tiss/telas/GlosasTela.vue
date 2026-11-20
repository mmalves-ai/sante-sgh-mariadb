<script setup lang="ts">
// Retorno e glosa (ficha do M31, seção 7): `/faturamento/glosas`. A fila de trabalho por CONTA (régua: a competência),
// com o cobrado, o pago, a glosa (conciliado e glosado são campos distintos: GLOSADO é a baixa) e os itens em recurso;
// a conta aberta mostra cada item com o motivo da tabela 38, o prazo do recurso pela operadora e as ações: decidir
// (aceitar com motivo ou recorrer com justificativa e evidência do prontuário), recorrer e registrar o desfecho
// (acatado, parcial ou negado, com o número do demonstrativo). Grade acessível com paginação no servidor (D-GRADE-31).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import type { EvidenciaGlosaLida, ItemGlosaLido } from '@sgh/contratos';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  decidir,
  itensGlosa,
  lerEvidencia,
  lerGrade,
  lerMotivos,
  novaChave,
  recorrer,
  registrarDesfecho,
} from '../api-tiss.js';
import { competenciaAtual, data, numero, opcoesConvenio, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const rota = useRoute();
const qc = useQueryClient();
const { apoio, pode, motivoFuncionalidade } = usarTiss('glosa');
const convenio = ref('');
const competencia = ref('');
const estado = ref('com-glosa');
const pagina = ref(0);
const filtro = ref<{ convenio: string; competencia: string; estado: string } | null>(null);
const conta = computed<number | null>(() => (rota.query['conta'] ? Number(rota.query['conta']) : null));
const acao = ref<{ tipo: 'decidir' | 'recorrer' | 'desfecho'; item: ItemGlosaLido } | null>(null);
const decisao = ref<'aceitar' | 'recorrer'>('recorrer');
const texto = ref('');
const evidencia = ref('');
const dataAcao = ref('');
const valor = ref('');
const desfecho = ref<'acatado' | 'parcial' | 'negado'>('acatado');
const motivoDesfecho = ref('0');
const demonstrativo = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const avisos = ref<readonly string[]>([]);
const gravando = ref(false);

const convenios = computed(() => opcoesConvenio(apoio.data.value?.convenios, t('tiss.todos')));
const estados = computed(() =>
  ['com-glosa', 'em-recurso', 'nao-conciliadas', 'todas'].map((v) => ({
    valor: v,
    rotulo: t(`tiss.glosas.filtros.${v}`),
  })),
);
const motivos = useQuery({ queryKey: ['tiss', 'motivos'], queryFn: () => lerMotivos(), staleTime: 300_000 });
const opcoesMotivo = computed(() =>
  (motivos.data.value ?? []).map((m) => ({ valor: String(m.codigo), rotulo: `${m.codigo} — ${m.nome}` })),
);
const grade = useQuery({
  queryKey: computed(() => ['tiss', 'grade', filtro.value, pagina.value]),
  queryFn: () => lerGrade({ ...filtro.value!, pagina: pagina.value }),
  enabled: computed(() => filtro.value !== null),
});
const itens = useQuery({
  queryKey: computed(() => ['tiss', 'itens-glosa', conta.value]),
  queryFn: () => itensGlosa(conta.value!),
  enabled: computed(() => conta.value !== null),
});
function buscar() {
  pagina.value = 0;
  filtro.value = {
    convenio: convenio.value,
    competencia: competencia.value || competenciaAtual(apoio.data.value?.hoje),
    estado: estado.value,
  };
}
const evidenciaLida = ref<EvidenciaGlosaLida | null>(null);
/** A evidência do prontuário só pela rota auditada (nunca vem na grade). */
async function verEvidencia(item: ItemGlosaLido) {
  erro.value = null;
  evidenciaLida.value = null;
  try {
    evidenciaLida.value = await lerEvidencia(item.item);
  } catch (e) {
    erro.value = e;
  }
}
function abrir(tipo: 'decidir' | 'recorrer' | 'desfecho', item: ItemGlosaLido) {
  acao.value = { tipo, item };
  texto.value = '';
  evidencia.value = '';
  valor.value = '';
  dataAcao.value = apoio.data.value?.hoje ?? '';
  demonstrativo.value = '';
  erro.value = null;
  mensagem.value = null;
}
async function confirmar() {
  const a = acao.value;
  if (!a) return;
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r =
      a.tipo === 'decidir'
        ? await decidir(
            { item: a.item.item, decisao: decisao.value, texto: texto.value, evidencia: evidencia.value },
            novaChave('decisao'),
          )
        : a.tipo === 'recorrer'
          ? await recorrer(
              {
                itens: [
                  {
                    item: a.item.item,
                    versao: a.item.versao,
                    valor: valor.value ? numero(valor.value) : null,
                    quantidade: null,
                  },
                ],
                dataProtocolo: dataAcao.value,
              },
              novaChave('recurso'),
            )
          : await registrarDesfecho(
              {
                itens: [
                  {
                    item: a.item.item,
                    versao: a.item.versao,
                    desfecho: desfecho.value,
                    valor: desfecho.value === 'parcial' && valor.value ? numero(valor.value) : null,
                    motivo: desfecho.value === 'acatado' ? null : Number(motivoDesfecho.value || 0),
                  },
                ],
                data: dataAcao.value,
                numeroDemonstrativo: demonstrativo.value,
              },
              novaChave('desfecho'),
            );
    mensagem.value = r.mensagem;
    avisos.value = r.avisos;
    acao.value = null;
    await qc.invalidateQueries({ queryKey: ['tiss'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const recursoAberto = (i: ItemGlosaLido) => i.valorRecurso > 0 && i.dataRetorno === null;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gl-titulo" data-testid="tela-tiss-glosas">
    <h1 id="gl-titulo">{{ t('tiss.glosas.titulo') }}</h1>
    <p>{{ t('tiss.glosas.texto') }}</p>
    <p class="secundario">{{ t('tiss.regua') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('conciliacao')" />
    <form class="filtros" @submit.prevent="buscar">
      <span class="campo">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('tiss.convenio')"
          :opcoes="convenios"
          data-testid="gl-convenio"
        />
      </span>
      <span class="campo">
        <label for="gl-competencia">{{ t('tiss.competencia') }}</label>
        <input id="gl-competencia" v-model="competencia" type="month" data-testid="gl-competencia" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="estado"
          :rotulo="t('tiss.situacao')"
          :opcoes="estados"
          data-testid="gl-estado"
        />
      </span>
      <button type="submit" data-testid="gl-buscar">{{ t('tiss.buscar') }}</button>
    </form>
    <ErroFaturamento v-if="grade.error.value" :erro="grade.error.value" />
    <template v-else-if="grade.data.value">
      <p v-if="grade.data.value.contas.length === 0">{{ t('tiss.nenhum') }}</p>
      <table v-else class="tabela" data-testid="gl-grade">
        <caption class="secundario">
          {{
            grade.data.value.total
          }}
          ·
          {{
            t('tiss.pagina')
          }}
          {{
            grade.data.value.pagina + 1
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.conta') }}</th>
            <th scope="col">{{ t('tiss.competencia') }}</th>
            <th scope="col">{{ t('tiss.carteira') }}</th>
            <th scope="col">{{ t('tiss.cobrado') }}</th>
            <th scope="col">{{ t('tiss.pago') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
            <th scope="col">{{ t('tiss.glosas.glosados') }}</th>
            <th scope="col">{{ t('tiss.glosas.emRecurso') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in grade.data.value.contas" :key="x.conta" :data-testid="`gl-conta-${x.conta}`">
            <td>
              <RouterLink
                :to="{ path: '/faturamento/glosas', query: { conta: String(x.conta) } }"
                :data-testid="`gl-abrir-${x.conta}`"
                >{{ x.conta }}</RouterLink
              >
              <span class="secundario"> · {{ x.chave }}</span>
            </td>
            <td>{{ x.competencia }}</td>
            <td>{{ x.beneficiario }}</td>
            <td>{{ reais(x.cobrado) }}</td>
            <td>{{ reais(x.pago) }}</td>
            <td>{{ reais(x.glosa) }}</td>
            <td>{{ x.itensGlosados }}</td>
            <td>{{ x.itensEmRecurso }}</td>
          </tr>
        </tbody>
      </table>
      <div class="filtros">
        <button type="button" :disabled="pagina === 0" @click="pagina -= 1">{{ t('tiss.anterior') }}</button>
        <button
          type="button"
          :disabled="(pagina + 1) * grade.data.value.porPagina >= grade.data.value.total"
          @click="pagina += 1"
        >
          {{ t('tiss.proxima') }}
        </button>
      </div>
    </template>

    <template v-if="conta !== null">
      <h2>{{ t('tiss.glosas.itensDaConta', { conta }) }}</h2>
      <ErroFaturamento v-if="itens.error.value" :erro="itens.error.value" />
      <p v-else-if="!itens.data.value" role="status">{{ t('tiss.carregando') }}</p>
      <table v-else class="tabela" data-testid="gl-itens">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.item') }}</th>
            <th scope="col">{{ t('tiss.cobrado') }}</th>
            <th scope="col">{{ t('tiss.glosas.conciliado') }}</th>
            <th scope="col">{{ t('tiss.pago') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
            <th scope="col">{{ t('tiss.motivo') }}</th>
            <th scope="col">{{ t('tiss.glosas.recurso') }}</th>
            <th scope="col">{{ t('tiss.situacao') }}</th>
            <th scope="col">{{ t('tiss.glosas.prazo') }}</th>
            <th scope="col">{{ t('tiss.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in itens.data.value" :key="i.item" :data-testid="`gl-item-${i.item}`">
            <td>{{ i.codigo }} · {{ i.descricao }}</td>
            <td>{{ reais(i.valorCobrado) }}</td>
            <td>{{ i.conciliado ? t('tiss.sim') : t('tiss.nao') }}</td>
            <td>{{ i.conciliado ? reais(i.valorPago) : '—' }}</td>
            <td>{{ i.conciliado ? reais(i.glosa) : '—' }}</td>
            <td>
              {{ i.motivo ? `${i.motivo} ${i.motivoNome}` : '—' }}
              <span v-if="i.conciliado && !i.reapresenta" class="secundario"
                >· {{ t('tiss.glosas.semReapresentacao') }}</span
              >
            </td>
            <td>
              {{ i.valorRecurso ? reais(i.valorRecurso) : '—' }}
              <span v-if="i.dataRecurso" class="secundario">· {{ data(i.dataRecurso) }}</span>
              <span v-if="i.desfecho" class="secundario"
                >· {{ t(`tiss.glosas.desfechos.${i.desfecho}`) }} {{ reais(i.valorRetorno) }}</span
              >
            </td>
            <td :data-testid="`gl-estado-${i.item}`">{{ t(`tiss.glosas.estados.${i.estado}`) }}</td>
            <td>{{ i.prazoRecurso ? data(i.prazoRecurso) : (i.alertaPrazo ?? '—') }}</td>
            <td class="acoes">
              <button
                v-if="i.decisao?.temEvidencia"
                type="button"
                :disabled="!pode('decidirGlosa')"
                :data-testid="`gl-evidencia-${i.item}`"
                @click="verEvidencia(i)"
              >
                {{ t('tiss.glosas.verEvidencia') }}
              </button>
              <button
                v-if="i.estado === 'pendente'"
                type="button"
                :disabled="!pode('decidirGlosa')"
                :data-testid="`gl-decidir-${i.item}`"
                @click="abrir('decidir', i)"
              >
                {{ t('tiss.glosas.decidir') }}
              </button>
              <button
                v-if="i.conciliado && i.glosa > 0 && i.valorRecurso === 0 && i.estado !== 'aceita'"
                type="button"
                :disabled="!pode('faturamento.registrarRecurso')"
                :data-testid="`gl-recorrer-${i.item}`"
                @click="abrir('recorrer', i)"
              >
                {{ t('tiss.glosas.recorrer') }}
              </button>
              <button
                v-if="recursoAberto(i)"
                type="button"
                :disabled="!pode('faturamento.registrarRetornoRecurso')"
                :data-testid="`gl-desfecho-${i.item}`"
                @click="abrir('desfecho', i)"
              >
                {{ t('tiss.glosas.desfecho') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <section
      v-if="evidenciaLida"
      class="formulario"
      role="dialog"
      aria-labelledby="gl-evidencia-titulo"
      data-testid="gl-evidencia-lida"
    >
      <h2 id="gl-evidencia-titulo">{{ t('tiss.glosas.evidenciaDoItem', { item: evidenciaLida.item }) }}</h2>
      <p data-testid="gl-evidencia-texto">{{ evidenciaLida.evidencia }}</p>
      <p class="secundario">
        {{
          t('tiss.glosas.evidenciaRegistrada', {
            por: evidenciaLida.decididoPor,
            em: data(evidenciaLida.decididoEm.slice(0, 10)),
          })
        }}
      </p>
      <div class="filtros">
        <button type="button" @click="evidenciaLida = null">{{ t('tiss.glosas.fechar') }}</button>
      </div>
    </section>

    <form
      v-if="acao"
      class="formulario"
      role="dialog"
      aria-labelledby="gl-acao-titulo"
      data-testid="gl-acao"
      @submit.prevent="confirmar"
    >
      <h2 id="gl-acao-titulo">{{ t(`tiss.glosas.acoes.${acao.tipo}`, { item: acao.item.item }) }}</h2>
      <template v-if="acao.tipo === 'decidir'">
        <span class="campo">
          <SanteSelecao
            v-model="decisao"
            :rotulo="t('tiss.glosas.decisao')"
            :opcoes="[
              { valor: 'recorrer', rotulo: t('tiss.glosas.recorrer') },
              { valor: 'aceitar', rotulo: t('tiss.glosas.aceitar') },
            ]"
            data-testid="gl-decisao"
          />
        </span>
        <span class="campo">
          <label for="gl-texto">{{
            decisao === 'aceitar' ? t('tiss.glosas.motivoAceite') : t('tiss.glosas.justificativa')
          }}</label>
          <textarea
            id="gl-texto"
            v-model="texto"
            rows="3"
            maxlength="2000"
            required
            data-testid="gl-texto"
          ></textarea>
        </span>
        <span v-if="decisao === 'recorrer'" class="campo">
          <label for="gl-evidencia">{{ t('tiss.glosas.evidencia') }}</label>
          <input id="gl-evidencia" v-model="evidencia" maxlength="250" data-testid="gl-evidencia" />
        </span>
      </template>
      <template v-else>
        <span class="campo">
          <label for="gl-data">{{
            acao.tipo === 'recorrer' ? t('tiss.glosas.dataProtocolo') : t('tiss.glosas.dataRetorno')
          }}</label>
          <input id="gl-data" v-model="dataAcao" type="date" required data-testid="gl-data" />
        </span>
        <span v-if="acao.tipo === 'desfecho'" class="campo">
          <SanteSelecao
            v-model="desfecho"
            :rotulo="t('tiss.glosas.desfecho')"
            :opcoes="
              (['acatado', 'parcial', 'negado'] as const).map((d) => ({
                valor: d,
                rotulo: t(`tiss.glosas.desfechos.${d}`),
              }))
            "
            data-testid="gl-tipo-desfecho"
          />
        </span>
        <span v-if="acao.tipo === 'recorrer' || desfecho === 'parcial'" class="campo">
          <label for="gl-valor">{{
            acao.tipo === 'recorrer' ? t('tiss.glosas.valorRecurso') : t('tiss.glosas.valorRetorno')
          }}</label>
          <input id="gl-valor" v-model="valor" inputmode="decimal" data-testid="gl-valor" />
        </span>
        <span v-if="acao.tipo === 'desfecho' && desfecho !== 'acatado'" class="campo">
          <SanteSelecao
            v-model="motivoDesfecho"
            :rotulo="t('tiss.motivo')"
            :opcoes="opcoesMotivo"
            data-testid="gl-motivo-desfecho"
          />
        </span>
        <span v-if="acao.tipo === 'desfecho'" class="campo">
          <label for="gl-demonstrativo">{{ t('tiss.glosas.numeroDemonstrativo') }}</label>
          <input
            id="gl-demonstrativo"
            v-model="demonstrativo"
            maxlength="20"
            required
            data-testid="gl-demonstrativo"
          />
        </span>
      </template>
      <div class="filtros">
        <button type="submit" :disabled="gravando" data-testid="gl-confirmar">
          {{ t('tiss.confirmar') }}
        </button>
        <button type="button" @click="acao = null">{{ t('tiss.cancelar') }}</button>
      </div>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="avisos" testid="gl-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
/* WCAG 2.5.8 (axe target-size): com "Ver evidência" ao lado de "Desfecho", cada alvo precisa de 24 px. */
.acoes button {
  min-height: 24px;
  min-width: 24px;
}
</style>
