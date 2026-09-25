import math
from statistics import NormalDist
N_ = NormalDist()
Z = N_.inv_cdf
gamma = 0.5772156649

def emax(n, mean=0.0, var=1.0):
    """Bailey & Lopez de Prado (2014) Eq.1: expected max of n iid N(mean,var) SR estimates."""
    return mean + math.sqrt(var)*((1-gamma)*Z(1-1/n) + gamma*Z(1-1/(n*math.e)))

print("=== E[max SR] under the null (true SR=0) — DSR Eq.1, var of trial SRs = V ===")
for n in [2,3,4,5,8,10,20,50,100,1000]:
    print(f"  N={n:5d}  E[max]/sqrt(V) = {emax(n):.4f}")

print()
print("=== Lo (2002) SE of Sharpe: SE = sqrt((1+SR^2/2)/T), iid returns ===")
def se_sr(sr, T): return math.sqrt((1+0.5*sr*sr)/T)
for T in [21,30,42,60,126,252,504,1260]:
    print(f"  T={T:5d} obs: SE(SR_per-bar~0) = {se_sr(0.0,T):.4f} ; 95% CI half-width = {1.96*se_sr(0,T):.4f}")

print()
print("=== MinTRL (Bailey & Lopez de Prado): obs needed for SR>0 at 95%, normal returns (skew 0, kurt 3) ===")
def mintrl(sr, alpha=0.05, skew=0.0, kurt=3.0):
    z = Z(1-alpha)
    return 1 + (1 - skew*sr + (kurt-1)/4*sr*sr)*(z/sr)**2
print("  per-bar SR -> annualised SR (252) -> MinTRL in bars")
for sr_ann in [0.5,1.0,1.5,2.0,2.5,3.0,4.0,6.0]:
    sr_d = sr_ann/math.sqrt(252)
    print(f"   ann SR {sr_ann:4.1f} (daily {sr_d:.4f}) -> MinTRL = {mintrl(sr_d):8.1f} daily bars = {mintrl(sr_d)/252:6.2f} yrs")
print("  with negative skew -3, kurtosis 10 (the DSR paper's example):")
for sr_ann in [1.0,2.0,2.5]:
    sr_d = sr_ann/math.sqrt(252)
    print(f"   ann SR {sr_ann:4.1f} -> MinTRL = {mintrl(sr_d,skew=-3,kurt=10):8.1f} daily bars = {mintrl(sr_d,skew=-3,kurt=10)/252:6.2f} yrs")

print()
print("=== What can 30 / 42 daily observations resolve? (one-sided 95%, power 80%) ===")
# T needed so a true per-bar SR is detectable vs 0: T >= ((z_a+z_b)/SR)^2 approx (ignoring higher moments)
za, zb = Z(0.95), Z(0.80)
for sr_ann in [1,2,3,4,6,8,10]:
    sr_d = sr_ann/math.sqrt(252)
    T = ((za+zb)/sr_d)**2
    print(f"   true ann SR {sr_ann:4.1f}: T for 80% power = {T:8.1f} daily bars ({T/252:5.2f} yrs)")

print()
print("=== Detectable annualised SR given T observations (one-sided 95%, 80% power) ===")
for T in [21,30,42,60,126,252]:
    sr_d = (za+zb)/math.sqrt(T)
    print(f"   T={T:4d} bars -> smallest detectable ann SR = {sr_d*math.sqrt(252):6.2f}")

print()
print("=== Difference of two Sharpes, Jobson-Korkie/Memmel, iid, correlation rho between the two return series ===")
# Var(SR1-SR2) ~ (1/T)*(2 - 2rho + 0.5*(SR1^2+SR2^2) - rho*SR1*SR2*(1+rho^2)/... ) use Memmel(2003) simplified:
def var_diff(sr1, sr2, rho, T):
    return (1.0/T)*(2 - 2*rho + 0.5*(sr1**2 + sr2**2) - (sr1*sr2*(1+rho**2))/2.0)
for rho in [0.0,0.5,0.8,0.95]:
    # T needed to detect a difference of D in ANNUAL SR terms, 95% one-sided + 80% power
    for D_ann in [0.5,1.0,2.0]:
        d = D_ann/math.sqrt(252)
        # solve T: d / sqrt(var_diff/... ) ; var_diff already has 1/T
        v1 = var_diff(0,0,rho,1)   # per-1-obs variance with small SRs
        T = ((za+zb)**2)*v1/(d**2)
        print(f"   rho={rho:4.2f}  annual-SR gap {D_ann:3.1f}: T = {T:9.1f} daily bars ({T/252:7.2f} yrs)")
