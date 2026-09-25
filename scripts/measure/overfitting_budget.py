import math
from statistics import NormalDist
Z=NormalDist().inv_cdf; g=0.5772156649
def emax(n): return (1-g)*Z(1-1/n)+g*Z(1-1/(n*math.e))
print("MinBTL (years of data needed so that the BEST of N trials has E[in-sample annualised SR]<=1 when true SR=0)")
print("  = E[max_N]^2 years   (Bailey/Borwein/LdP/Zhu 2014)")
for n in [2,3,4,5,8,10,16,20,32,45,50,64,100,256,1000]:
    y=emax(n)**2
    print(f"  N={n:5d}  E[max_N]={emax(n):.4f}  MinBTL={y:7.2f} yrs = {y*252:8.0f} daily bars")
print()
print("Flip it: with Y years of daily data, the max N you can try before E[max IS SR]>1:")
import bisect
for Y in [6/52, 0.25, 0.5, 1, 2, 5, 10]:
    n=2
    while emax(n+1)**2 <= Y and n < 10**7: n+=1
    print(f"  {Y*52:5.1f} weeks ({Y:5.2f} yrs): max N = {n}")
