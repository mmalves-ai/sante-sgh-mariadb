<script setup lang="ts">
// Vacinação do colaborador (M52.5; item `Gestão de pessoas > SESMT > Vacinação do colaborador`;
// `pessoas.vacinacao.ler` / `.registrar`; regra 17, NR-32): a situação de cada vacina do programa (esquema, reforço,
// anti-HBs e as pendências), os registros com o retificado riscado e nunca apagado, o registro da dose (lote e validade:
// lote vencido é recusado) ou do anti-HBs, e o domínio de vacinas embutido (CRUD genérico).
import {
  CODIGOS_DOSE_VACINA_SESMT,
  CODIGOS_VACINA_SESMT,
  type ColaboradorSesmt,
  DOSES_VACINA_SESMT,
  type DoseVacinaSesmt,
  esquemaRegistrarVacinaColaborador,
  VACINAS_SESMT,
  type VacinaSesmt,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr, semVinculo } from '../comum.js';
import { lerApoioSesmt, lerCarteira, registrarVacina } from './api-sesmt.js';
import PendenciasSesmt from './PendenciasSesmt.vue';
import SeletorColaborador from './SeletorColaborador.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['sesmt', 'apoio', 'vacinas'], queryFn: () => lerApoioSesmt('vacinas') });
const a = computed(() => apoio.data.value ?? null);
const colaborador = ref<ColaboradorSesmt | null>(null);
const vinculo = computed(() => colaborador.value?.vinculo ?? null);
const carteira = useQuery({
  queryKey: computed(() => ['sesmt', 'vacinas', vinculo.value]),
  queryFn: () => lerCarteira(vinculo.value!),
  enabled: computed(() => vinculo.value !== null),
});
const c = computed(() => carteira.data.value ?? null);

const registrando = ref(false);
const retifica = ref<number | null>(null);
const registro = ref<'dose' | 'anti-hbs'>('dose');
const vacina = ref<VacinaSesmt | null>(null);
const dose = ref<DoseVacinaSesmt | null>(null);
const data = ref<string | null>(null);
const lote = ref('');
const validadeLote = ref<string | null>(null);
const antiHbs = ref('');
const observacao = ref('');
const motivoRetificacao = ref('');
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const opcoesRegistro = computed(() => [
  { valor: 'dose' as const, rotulo: t('sesmt.vacinas.tipos.dose') },
  { valor: 'anti-hbs' as const, rotulo: t('sesmt.vacinas.tipos.antiHbs') },
]);
const opcoesVacina = CODIGOS_VACINA_SESMT.map((v) => ({ valor: v, rotulo: VACINAS_SESMT[v].rotulo }));
const opcoesDose = CODIGOS_DOSE_VACINA_SESMT.map((d) => ({ valor: d, rotulo: DOSES_VACINA_SESMT[d].rotulo }));
function novo(id: number | null = null): void {
  const base = id !== null ? c.value?.registros.find((x) => x.id === id) : undefined;
  registrando.value = true;
  retifica.value = id;
  registro.value = base?.registro ?? 'dose';
  vacina.value = base?.vacina ?? null;
  dose.value = base?.dose ?? null;
  data.value = base?.data ?? null;
  lote.value = base?.lote ?? '';
  validadeLote.value = base?.validadeLote ?? null;
  antiHbs.value = base?.antiHbs !== null && base?.antiHbs !== undefined ? String(base.antiHbs) : '';
  observacao.value = base?.observacao ?? '';
  motivoRetificacao.value = '';
  erro.value = null;
}
watch(vinculo, () => {
  registrando.value = false;
  aviso.value = null;
});
watch(registro, (r) => {
  if (r === 'anti-hbs') vacina.value = 'hepatite-b';
});
const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const entrada = computed(() =>
  esquemaRegistrarVacinaColaborador.safeParse({
    vinculo: vinculo.value ?? 0,
    registro: registro.value,
    vacina: vacina.value ?? '',
    dose: registro.value === 'dose' ? dose.value : null,
    data: data.value ?? '',
    lote: registro.value === 'dose' ? lote.value.trim() || null : null,
    validadeLote: registro.value === 'dose' ? validadeLote.value : null,
    antiHbs: registro.value === 'anti-hbs' ? numero(antiHbs.value) : null,
    observacao: observacao.value.trim() || null,
    retifica: retifica.value,
    motivoRetificacao: retifica.value !== null ? motivoRetificacao.value.trim() || null : null,
  }),
);
async function gravar(): Promise<void> {
  if (!entrada.value.success || vinculo.value === null) return;
  erro.value = null;
  try {
    const r = await registrarVacina(vinculo.value, semVinculo(entrada.value.data));
    registrando.value = false;
    aviso.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sesmt'] });
  } catch (x) {
    erro.value = x;
  }
}
const esquemaTexto = (s: { doses: number; esquema: number }) =>
  s.esquema > 0
    ? t('sesmt.vacinas.doses', { d: s.doses, e: s.esquema })
    : t('sesmt.vacinas.semEsquema', { d: s.doses });
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="sesmt-vac-titulo" data-testid="tela-sesmt-vacinas">
    <h1 id="sesmt-vac-titulo">{{ t('sesmt.vacinas.titulo') }}</h1>
    <p>{{ t('sesmt.vacinas.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('sesmt.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="!a.gravacao.ligada" :texto="a.gravacao.motivo ?? ''" variante="info" />
      <SanteAlerta v-else-if="!a.acoes.vacina" :texto="t('sesmt.soConsulta')" variante="info" />
      <SeletorColaborador v-model="colaborador" tela="vacinas" />
      <template v-if="colaborador">
        <SanteAlerta :texto="t('sesmt.leituraAuditada')" variante="info" />
        <ErroPessoas v-if="carteira.isError.value" :erro="carteira.error.value" />
        <p v-else-if="!c" role="status">{{ t('sesmt.carregando') }}</p>
        <template v-else>
          <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="sesmt-aviso" />
          <section class="bloco" aria-labelledby="sesmt-vac-situacao" data-testid="situacao-vacinas">
            <h2 id="sesmt-vac-situacao">{{ t('sesmt.vacinas.situacao') }}</h2>
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('sesmt.vacinas.vacina') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.esquema') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.ultimaDose') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.antiHbs') }}</th>
                  <th scope="col">{{ t('sesmt.pendencias') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in c.situacao" :key="s.vacina" :data-testid="`vacina-${s.vacina}`">
                  <th scope="row">{{ s.rotulo }}</th>
                  <td>
                    {{ esquemaTexto(s) }} ·
                    {{ s.completo ? t('sesmt.vacinas.completo') : t('sesmt.vacinas.incompleto') }}
                    <span v-if="s.reforcoAte" class="secundario">{{
                      t('sesmt.vacinas.reforcoAte', { d: dataBr(s.reforcoAte) })
                    }}</span>
                  </td>
                  <td>{{ dataBr(s.ultimaDose) }}</td>
                  <td>{{ s.antiHbs ?? '' }}</td>
                  <td><PendenciasSesmt :pendencias="s.pendencias" /></td>
                </tr>
              </tbody>
            </table>
          </section>
          <section class="bloco" aria-labelledby="sesmt-vac-registros" data-testid="registros-vacinas">
            <h2 id="sesmt-vac-registros">{{ t('sesmt.vacinas.registros') }}</h2>
            <p v-if="c.registros.length === 0">{{ t('sesmt.nenhum') }}</p>
            <table v-else class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('sesmt.data') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.vacina') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.registro') }}</th>
                  <th scope="col">{{ t('sesmt.vacinas.lote') }}</th>
                  <th scope="col"><span class="secundario">—</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in c.registros"
                  :key="r.id"
                  :class="{ retificado: r.retificadoPor !== null }"
                  :data-testid="`registro-vacina-${r.id}`"
                >
                  <td>{{ dataBr(r.data) }}</td>
                  <td>{{ r.vacinaRotulo }}</td>
                  <td>
                    {{
                      r.registro === 'dose' && r.dose
                        ? DOSES_VACINA_SESMT[r.dose].rotulo
                        : `${r.antiHbs} mUI/mL`
                    }}
                  </td>
                  <td>
                    {{ r.lote ?? '' }}
                    <span v-if="r.validadeLote" class="secundario">{{ dataBr(r.validadeLote) }}</span>
                  </td>
                  <td>
                    <span v-if="r.retificadoPor !== null" class="secundario">{{
                      t('sesmt.retificado', { id: r.retificadoPor })
                    }}</span>
                    <span v-else-if="r.retifica !== null" class="secundario">{{
                      t('sesmt.retifica', { id: r.retifica })
                    }}</span>
                    <SanteBotao
                      v-if="a.acoes.vacina && r.retificadoPor === null"
                      :rotulo="t('sesmt.retificar')"
                      variante="texto"
                      :data-testid="`retificar-vacina-${r.id}`"
                      @acionar="novo(r.id)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="acoes">
              <SanteBotao
                v-if="a.acoes.vacina && !registrando"
                :rotulo="t('sesmt.vacinas.novo')"
                data-testid="nova-vacina"
                @acionar="novo()"
              />
            </div>
          </section>
          <form
            v-if="registrando"
            class="bloco"
            :aria-label="t('sesmt.vacinas.novo')"
            data-testid="form-vacina"
            @submit.prevent="gravar"
          >
            <h2>{{ t('sesmt.vacinas.novo') }}</h2>
            <SanteAlerta v-if="retifica !== null" :texto="t('sesmt.retificacaoAviso')" variante="info" />
            <SanteOpcoes
              v-model="registro"
              :legenda="t('sesmt.vacinas.registro')"
              :opcoes="opcoesRegistro"
              data-testid="vacina-registro"
            />
            <div class="campos">
              <SanteSelecao
                v-model="vacina"
                :rotulo="t('sesmt.vacinas.vacina')"
                :opcoes="opcoesVacina"
                :desabilitado="registro === 'anti-hbs'"
                data-testid="vacina-vacina"
              />
              <SanteData v-model="data" :rotulo="t('sesmt.data')" editavel data-testid="vacina-data" />
              <template v-if="registro === 'dose'">
                <SanteSelecao
                  v-model="dose"
                  :rotulo="t('sesmt.vacinas.dose')"
                  :opcoes="opcoesDose"
                  data-testid="vacina-dose"
                />
                <SanteCampoTexto
                  v-model="lote"
                  :rotulo="t('sesmt.vacinas.lote')"
                  :max-bytes="30"
                  data-testid="vacina-lote"
                />
                <SanteData
                  v-model="validadeLote"
                  :rotulo="t('sesmt.vacinas.validadeLote')"
                  editavel
                  data-testid="vacina-validade-lote"
                />
              </template>
              <SanteCampoTexto
                v-else
                v-model="antiHbs"
                :rotulo="t('sesmt.vacinas.antiHbs')"
                :max-bytes="12"
                data-testid="vacina-anti-hbs"
              />
            </div>
            <SanteCampoTexto
              v-model="observacao"
              :rotulo="t('sesmt.observacao')"
              :max-bytes="400"
              data-testid="vacina-observacao"
            />
            <template v-if="retifica !== null">
              <SanteCampoTexto
                v-model="motivoRetificacao"
                :rotulo="t('sesmt.motivoRetificacao')"
                :max-bytes="400"
                data-testid="vacina-motivo-retificacao"
              />
              <p class="secundario">{{ t('sesmt.motivoAjuda') }}</p>
            </template>
            <ErroPessoas v-if="erro" :erro="erro" />
            <div class="acoes">
              <SanteBotao :rotulo="t('sesmt.cancelar')" variante="texto" @acionar="registrando = false" />
              <SanteBotao
                :rotulo="t('sesmt.gravar')"
                tipo="submit"
                :desabilitado="!entrada.success"
                data-testid="vacina-gravar"
              />
            </div>
          </form>
        </template>
      </template>
    </template>
    <GrupoDominiosTela subitem="rhVacinacaoColaborador" embutida />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.retificado td {
  text-decoration: line-through;
  color: var(--p-text-muted-color);
}
.retificado td:last-child {
  text-decoration: none;
}
</style>
