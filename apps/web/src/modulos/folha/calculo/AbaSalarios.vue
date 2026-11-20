<script setup lang="ts">
// Aba "Salários" (M53.3, etapa F2; leitura com `pessoas.salario.ler`, sensível e auditada no servidor; gravação com
// `pessoas.salario.editar`): o colaborador pela busca da gestão de pessoas (`pessoas.colaborador.ler`), as vigências do
// salário contratual (a em vigor no fim da competência destacada) e o registro de uma nova vigência (valor, adicional de
// insalubridade ou de periculosidade, que não se acumulam, e o motivo). Vigência gravada nunca é alterada (D-SALHIST-533).
import {
  type ApoioCalculoFolha,
  type ColaboradorResumo,
  esquemaRegistrarSalario,
  GRAUS_INSALUBRIDADE,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerColaboradores } from '../../pessoas/api-pessoas.js';
import { dataBr } from '../../pessoas/comum.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { lerSalarios, registrarSalario } from './api-calculo.js';
import { lerCentavos, reais, ultimoDia, vigenteEm } from './comum-calculo.js';

const props = defineProps<{ apoio: ApoioCalculoFolha; competencia: string | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeBuscar = computed(() => permissoes.value.has('pessoas.colaborador.ler'));
const pode = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.salario);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

const termo = ref('');
const achados = ref<readonly ColaboradorResumo[] | null>(null);
const colaborador = ref<ColaboradorResumo | null>(null);
async function buscar(): Promise<void> {
  erro.value = null;
  if (termo.value.trim().length < 2) return;
  try {
    achados.value = (
      await lerColaboradores({ termo: termo.value.trim(), estado: 'todos', limite: 30 })
    ).itens;
  } catch (x) {
    erro.value = x;
  }
}
function escolher(c: ColaboradorResumo | null): void {
  colaborador.value = c;
  achados.value = null;
  registrando.value = false;
  aviso.value = null;
  if (!c) termo.value = '';
}
const lista = useQuery({
  queryKey: computed(() => ['folha', 'salarios', colaborador.value?.vinculo ?? null]),
  queryFn: () => lerSalarios(colaborador.value!.vinculo),
  enabled: computed(() => colaborador.value !== null),
});
const itens = computed(() =>
  lista.data.value ? [...lista.data.value.itens].sort((a, b) => b.inicio.localeCompare(a.inicio)) : null,
);
const referencia = computed(() => (props.competencia ? ultimoDia(props.competencia) : props.apoio.hoje));
const emVigor = computed(() => (itens.value ? vigenteEm(itens.value, referencia.value) : null));

// ── Nova vigência ───────────────────────────────────────────────────────────────────────────────────────────
const registrando = ref(false);
const inicio = ref<string | null>(null);
const valor = ref('');
const insalubridade = ref<number>(0);
const periculosidade = ref<'sim' | 'nao'>('nao');
const motivo = ref('');
const opcoesGrau = computed(() =>
  GRAUS_INSALUBRIDADE.map((g) => ({ valor: g as number, rotulo: t(`folha.calculo.salario.graus.${g}`) })),
);
const opcoesSimNao = computed(() => [
  { valor: 'nao' as const, rotulo: t('folha.calculo.salario.simNao.nao') },
  { valor: 'sim' as const, rotulo: t('folha.calculo.salario.simNao.sim') },
]);
function novo(): void {
  const a = emVigor.value;
  inicio.value = null;
  valor.value = '';
  insalubridade.value = a?.insalubridade ?? 0;
  periculosidade.value = a?.periculosidade ? 'sim' : 'nao';
  motivo.value = '';
  erro.value = null;
  aviso.value = null;
  registrando.value = true;
}
const centavos = computed(() => lerCentavos(valor.value));
const entrada = computed(() =>
  esquemaRegistrarSalario.safeParse({
    vinculo: colaborador.value?.vinculo ?? 0,
    inicio: inicio.value ?? '',
    salario: centavos.value ?? 0,
    insalubridade: insalubridade.value,
    periculosidade: periculosidade.value === 'sim',
    motivo: motivo.value.trim(),
  }),
);
const acumula = computed(() => periculosidade.value === 'sim' && insalubridade.value > 0);
async function gravar(): Promise<void> {
  if (!entrada.value.success) return;
  erro.value = null;
  try {
    const r = await registrarSalario(entrada.value.data);
    registrando.value = false;
    aviso.value = r.mensagem || t('folha.calculo.salario.gravado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'salarios'] });
  } catch (x) {
    erro.value = x;
  }
}
const quem = (c: { vinculo: number; matricula: string | null }) =>
  c.matricula
    ? `${t('folha.matricula', { m: c.matricula })} · ${t('folha.vinculo', { v: c.vinculo })}`
    : t('folha.vinculo', { v: c.vinculo });
const adicional = (s: { insalubridade: number; periculosidade: boolean }) =>
  s.periculosidade
    ? t('folha.calculo.salario.periculosidade')
    : t(`folha.calculo.salario.graus.${s.insalubridade}`);
</script>

<template>
  <section class="bloco" :aria-label="t('folha.calculo.salario.titulo')" data-testid="folha-salarios">
    <h2>{{ t('folha.calculo.salario.titulo') }}</h2>
    <p class="secundario">{{ t('folha.calculo.salario.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-salario-aviso" />
    <ErroFolha v-if="erro" :erro="erro" />
    <p v-if="!apoio.acoes.verSalario" data-testid="folha-salario-sem-permissao">
      {{ t('folha.calculo.salario.semPermissao') }}
    </p>
    <p v-else-if="!podeBuscar">{{ t('folha.calculo.salario.semBusca') }}</p>
    <template v-else>
      <div v-if="colaborador" class="campos">
        <p data-testid="folha-salario-colaborador">
          <strong>{{ colaborador.nome }}</strong>
          <span class="secundario"> · {{ quem(colaborador) }} · {{ colaborador.cargo }}</span>
        </p>
        <SanteBotao :rotulo="t('folha.calculo.salario.trocar')" variante="texto" @acionar="escolher(null)" />
      </div>
      <template v-else>
        <div class="campos">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('folha.calculo.salario.buscar')"
            :max-bytes="70"
            data-testid="folha-salario-termo"
          />
          <SanteBotao
            :rotulo="t('folha.calculo.salario.buscarBotao')"
            variante="secundario"
            data-testid="folha-salario-buscar"
            @acionar="buscar"
          />
        </div>
        <ul v-if="achados" class="lista" data-testid="folha-salario-achados">
          <li v-if="achados.length === 0">{{ t('folha.calculo.salario.nenhumColaborador') }}</li>
          <li v-for="c in achados" :key="c.vinculo">
            <SanteBotao
              :rotulo="`${c.nome} · ${quem(c)}`"
              variante="texto"
              :data-testid="`folha-salario-escolher-${c.vinculo}`"
              @acionar="escolher(c)"
            />
            <span class="secundario">{{ c.cargo }}</span>
          </li>
        </ul>
      </template>

      <template v-if="colaborador">
        <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
        <p v-else-if="!itens" role="status">{{ t('folha.carregando') }}</p>
        <p v-else-if="itens.length === 0" data-testid="folha-salario-nenhum">
          {{ t('folha.calculo.salario.nenhum') }}
        </p>
        <table v-else class="tabela" data-testid="folha-salario-vigencias">
          <caption class="secundario">
            {{
              t('folha.calculo.salario.vigencias')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('folha.calculo.salario.inicio') }}</th>
              <th scope="col">{{ t('folha.calculo.salario.valor') }}</th>
              <th scope="col">{{ t('folha.calculo.salario.insalubridade') }}</th>
              <th scope="col">{{ t('folha.calculo.salario.motivo') }}</th>
              <th scope="col">{{ t('folha.calculo.salario.registradoPor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in itens" :key="s.id" :data-testid="`folha-salario-${s.id}`">
              <th scope="row">
                {{ dataBr(s.inicio) }}
                <strong v-if="emVigor && emVigor.id === s.id" data-testid="folha-salario-em-vigor">
                  · {{ t('folha.calculo.salario.emVigor') }}
                </strong>
              </th>
              <td>{{ reais(s.salario) }}</td>
              <td>{{ adicional(s) }}</td>
              <td>{{ s.motivo }}</td>
              <td>{{ s.registradoPor }}</td>
            </tr>
          </tbody>
        </table>
        <div class="acoes">
          <SanteBotao
            v-if="pode && !registrando"
            :rotulo="t('folha.calculo.salario.registrar')"
            data-testid="folha-salario-novo"
            @acionar="novo"
          />
        </div>
        <form
          v-if="registrando"
          class="bloco"
          :aria-label="t('folha.calculo.salario.registrar')"
          data-testid="folha-salario-form"
          @submit.prevent="gravar"
        >
          <h3>{{ t('folha.calculo.salario.registrar') }}</h3>
          <div class="campos">
            <SanteData
              v-model="inicio"
              :rotulo="t('folha.calculo.salario.inicio')"
              editavel
              data-testid="folha-salario-inicio"
            />
            <SanteCampoTexto
              v-model="valor"
              :rotulo="t('folha.calculo.salario.valor')"
              :max-bytes="20"
              data-testid="folha-salario-valor"
            />
            <SanteSelecao
              v-model="insalubridade"
              :rotulo="t('folha.calculo.salario.insalubridade')"
              :opcoes="opcoesGrau"
              data-testid="folha-salario-insalubridade"
            />
            <SanteSelecao
              v-model="periculosidade"
              :rotulo="t('folha.calculo.salario.periculosidade')"
              :opcoes="opcoesSimNao"
              data-testid="folha-salario-periculosidade"
            />
          </div>
          <p v-if="valor && centavos === null" class="secundario" role="alert">
            {{ t('folha.calculo.salario.valorInvalido') }}
          </p>
          <p v-if="acumula" class="secundario" role="alert" data-testid="folha-salario-acumula">
            {{ t('folha.calculo.salario.naoAcumula') }}
          </p>
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('folha.calculo.salario.motivo')"
            :max-bytes="200"
            data-testid="folha-salario-motivo"
          />
          <div class="acoes">
            <SanteBotao :rotulo="t('folha.cancelar')" variante="texto" @acionar="registrando = false" />
            <SanteBotao
              :rotulo="t('folha.gravar')"
              tipo="submit"
              :desabilitado="!entrada.success"
              data-testid="folha-salario-gravar"
            />
          </div>
        </form>
      </template>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.lista {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.25rem;
}
</style>
